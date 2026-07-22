from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any


def _torch_modules():
    try:
        import torch
        from torch import nn
        from torch.nn import functional as functional
    except ImportError as error:
        raise RuntimeError("Install the training extra to use Game-JEPA models") from error
    return torch, nn, functional


@dataclass(frozen=True, slots=True)
class GameJepaConfig:
    frames: int
    height: int
    width: int
    embedding_dim: int
    depth: int
    heads: int
    tubelet_size: int
    patch_size: int
    mask_ratio: float
    ema_decay: float
    action_dim: int
    architecture_version: int
    state_prediction_weight: float
    variance_weight: float
    covariance_weight: float
    variance_target: float
    state_diversity_weight: float
    state_similarity_ceiling: float
    state_ema_decay: float
    contrastive_weight: float
    contrastive_temperature: float
    state_queue_size: int

    @classmethod
    def from_experiment(cls, config: dict[str, Any]) -> "GameJepaConfig":
        clip = config["clip"]
        model = config["model"]
        value = cls(
            frames=int(clip["frames"]),
            height=int(clip["height"]),
            width=int(clip["width"]),
            embedding_dim=int(model["embedding_dim"]),
            depth=int(model["depth"]),
            heads=int(model["heads"]),
            tubelet_size=int(model["tubelet_size"]),
            patch_size=int(model["patch_size"]),
            mask_ratio=float(model["mask_ratio"]),
            ema_decay=float(model["ema_decay"]),
            action_dim=int(model["action_dim"]),
            architecture_version=int(model.get("architecture_version", 1)),
            state_prediction_weight=float(model.get("state_prediction_weight", 0.0)),
            variance_weight=float(model.get("variance_weight", 0.0)),
            covariance_weight=float(model.get("covariance_weight", 0.0)),
            variance_target=float(model.get("variance_target", 0.5)),
            state_diversity_weight=float(model.get("state_diversity_weight", 0.0)),
            state_similarity_ceiling=float(
                model.get("state_similarity_ceiling", 0.95)
            ),
            state_ema_decay=float(model.get("state_ema_decay", model["ema_decay"])),
            contrastive_weight=float(model.get("contrastive_weight", 0.0)),
            contrastive_temperature=float(
                model.get("contrastive_temperature", 0.1)
            ),
            state_queue_size=int(model.get("state_queue_size", 0)),
        )
        value.validate()
        return value

    def validate(self) -> None:
        if self.frames % self.tubelet_size:
            raise ValueError("frames must be divisible by tubelet_size")
        if self.height % self.patch_size or self.width % self.patch_size:
            raise ValueError("training dimensions must be divisible by patch_size")
        if self.embedding_dim % self.heads:
            raise ValueError("embedding_dim must be divisible by heads")
        if not 0 < self.mask_ratio < 1:
            raise ValueError("mask_ratio must be in (0, 1)")
        if not 0 < self.ema_decay < 1:
            raise ValueError("ema_decay must be in (0, 1)")
        if self.architecture_version not in {1, 2, 3, 4}:
            raise ValueError("architecture_version must be 1, 2, 3, or 4")
        if min(
            self.state_prediction_weight,
            self.variance_weight,
            self.covariance_weight,
            self.state_diversity_weight,
            self.contrastive_weight,
        ) < 0:
            raise ValueError("JEPA auxiliary loss weights must be non-negative")
        if self.variance_target <= 0:
            raise ValueError("variance_target must be positive")
        if not -1 < self.state_similarity_ceiling < 1:
            raise ValueError("state_similarity_ceiling must be in (-1, 1)")
        if not 0 < self.state_ema_decay < 1:
            raise ValueError("state_ema_decay must be in (0, 1)")
        if self.contrastive_temperature <= 0:
            raise ValueError("contrastive_temperature must be positive")
        if self.state_queue_size < 0:
            raise ValueError("state_queue_size must be non-negative")
        if self.contrastive_weight > 0 and self.state_queue_size == 0:
            raise ValueError(
                "state_queue_size must be positive when contrastive_weight is enabled"
            )

    @property
    def token_count(self) -> int:
        return (
            self.frames // self.tubelet_size
            * (self.height // self.patch_size)
            * (self.width // self.patch_size)
        )


def build_game_jepa(config: GameJepaConfig):
    torch, nn, functional = _torch_modules()

    class TokenEncoder(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.patch_embed = nn.Conv3d(
                3,
                config.embedding_dim,
                kernel_size=(config.tubelet_size, config.patch_size, config.patch_size),
                stride=(config.tubelet_size, config.patch_size, config.patch_size),
            )
            self.position = nn.Parameter(
                torch.zeros(1, config.token_count, config.embedding_dim)
            )
            layer = nn.TransformerEncoderLayer(
                d_model=config.embedding_dim,
                nhead=config.heads,
                dim_feedforward=config.embedding_dim * 4,
                dropout=0.0,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            )
            self.transformer = nn.TransformerEncoder(
                layer, num_layers=config.depth, enable_nested_tensor=False
            )
            self.norm = nn.LayerNorm(config.embedding_dim)
            nn.init.trunc_normal_(self.position, std=0.02)

        def embed(self, video):
            tokens = self.patch_embed(video).flatten(2).transpose(1, 2)
            if tokens.shape[1] != config.token_count:
                raise ValueError(
                    f"Expected {config.token_count} tokens, received {tokens.shape[1]}"
                )
            return tokens + self.position

        def encode_tokens(self, tokens):
            return self.norm(self.transformer(tokens))

        def forward(self, video):
            return self.encode_tokens(self.embed(video))

    class TemporalStateHead(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.projection = nn.Sequential(
                nn.LayerNorm(config.embedding_dim),
                nn.Linear(config.embedding_dim, config.embedding_dim * 2),
                nn.GELU(),
                nn.Linear(config.embedding_dim * 2, config.embedding_dim),
            )
            self.output_norm = nn.LayerNorm(config.embedding_dim)

        def forward(self, tokens):
            temporal_tokens = config.frames // config.tubelet_size
            spatial_tokens = config.token_count // temporal_tokens
            batch, token_count, dimension = tokens.shape
            if token_count != temporal_tokens * spatial_tokens:
                raise ValueError(
                    f"Cannot reshape {token_count} tokens into temporal states"
                )
            states = tokens.reshape(
                batch, temporal_tokens, spatial_tokens, dimension
            ).mean(dim=2)
            return self.output_norm(states + self.projection(states))

    class GameJepa(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.config = config
            self.online = TokenEncoder()
            self.target = copy.deepcopy(self.online)
            for parameter in self.target.parameters():
                parameter.requires_grad = False
            self.mask_token = nn.Parameter(
                torch.zeros(1, 1, config.embedding_dim)
            )
            self.predictor = nn.Sequential(
                nn.LayerNorm(config.embedding_dim),
                nn.Linear(config.embedding_dim, config.embedding_dim * 2),
                nn.GELU(),
                nn.Linear(config.embedding_dim * 2, config.embedding_dim),
            )
            nn.init.trunc_normal_(self.mask_token, std=0.02)
            if config.architecture_version >= 2:
                self.online_state = TemporalStateHead()
                self.target_state = copy.deepcopy(self.online_state)
                for parameter in self.target_state.parameters():
                    parameter.requires_grad = False
                self.state_predictor = nn.Sequential(
                    nn.LayerNorm(config.embedding_dim),
                    nn.Linear(config.embedding_dim, config.embedding_dim * 2),
                    nn.GELU(),
                    nn.Linear(config.embedding_dim * 2, config.embedding_dim),
                )
            if config.architecture_version >= 4:
                self.register_buffer(
                    "state_queue",
                    torch.zeros(config.state_queue_size, config.embedding_dim),
                )
                self.register_buffer(
                    "state_queue_pointer", torch.zeros((), dtype=torch.long)
                )
                self.register_buffer(
                    "state_queue_count", torch.zeros((), dtype=torch.long)
                )

        def forward(self, video, mask=None):
            online_tokens = self.online.embed(video)
            if mask is None:
                mask = random_token_mask(
                    video.shape[0], config.token_count, config.mask_ratio, video.device
                )
            masked_tokens = torch.where(
                mask.unsqueeze(-1),
                self.mask_token.expand(video.shape[0], config.token_count, -1)
                + self.online.position.expand(video.shape[0], -1, -1),
                online_tokens,
            )
            context = self.online.encode_tokens(masked_tokens)
            prediction = functional.normalize(self.predictor(context), dim=-1)
            with torch.no_grad():
                target_tokens = self.target(video)
                target = functional.normalize(target_tokens, dim=-1)
            cosine = (prediction[mask] * target[mask]).sum(dim=-1).mean()
            if config.architecture_version == 1:
                loss = functional.smooth_l1_loss(prediction[mask], target[mask])
                return {
                    "loss": loss,
                    "token_prediction_loss": loss.detach(),
                    "masked_cosine_similarity": cosine.detach(),
                    "mask_ratio": mask.float().mean().detach(),
                    "pooled_state": context.mean(dim=1),
                }

            token_prediction_loss = 1 - cosine
            temporal_state = self.online_state(context)
            state_prediction = functional.normalize(
                self.state_predictor(temporal_state), dim=-1
            )
            with torch.no_grad():
                target_state = functional.normalize(
                    self.target_state(target_tokens), dim=-1
                )
            state_cosine = (state_prediction * target_state).sum(dim=-1).mean()
            state_prediction_loss = 1 - state_cosine
            contrastive_loss = temporal_state.new_zeros(())
            contrastive_accuracy = temporal_state.new_zeros(())
            if config.architecture_version == 2:
                pooled_state = temporal_state.mean(dim=1)
                variance_loss = representation_variance_loss(
                    temporal_state, config.variance_target
                )
                covariance_loss = representation_covariance_loss(temporal_state)
                state_diversity_loss = temporal_state.new_zeros(())
            else:
                pooled_state = temporal_state[:, -1]
                pooled_sequence = pooled_state.unsqueeze(1)
                variance_loss = 0.5 * (
                    representation_variance_loss(
                        temporal_state, config.variance_target
                    )
                    + representation_variance_loss(
                        pooled_sequence, config.variance_target
                    )
                )
                covariance_loss = 0.5 * (
                    representation_covariance_loss(temporal_state)
                    + representation_covariance_loss(pooled_sequence)
                )
                state_diversity_loss = representation_diversity_loss(
                    pooled_state, config.state_similarity_ceiling
                )
                if config.architecture_version >= 4:
                    contrastive_loss, contrastive_accuracy = state_contrastive_loss(
                        state_prediction[:, -1],
                        target_state[:, -1],
                        self._queued_state_keys() if self.training else None,
                        config.contrastive_temperature,
                    )
            loss = (
                token_prediction_loss
                + config.state_prediction_weight * state_prediction_loss
                + config.variance_weight * variance_loss
                + config.covariance_weight * covariance_loss
                + config.state_diversity_weight * state_diversity_loss
                + config.contrastive_weight * contrastive_loss
            )
            if config.architecture_version >= 4 and self.training:
                self._enqueue_state_keys(target_state[:, -1])
            return {
                "loss": loss,
                "token_prediction_loss": token_prediction_loss.detach(),
                "state_prediction_loss": state_prediction_loss.detach(),
                "variance_loss": variance_loss.detach(),
                "covariance_loss": covariance_loss.detach(),
                "state_diversity_loss": state_diversity_loss.detach(),
                "contrastive_loss": contrastive_loss.detach(),
                "contrastive_accuracy": contrastive_accuracy.detach(),
                "masked_cosine_similarity": cosine.detach(),
                "state_cosine_similarity": state_cosine.detach(),
                "mask_ratio": mask.float().mean().detach(),
                "pooled_state": pooled_state,
            }

        @torch.no_grad()
        def update_target(self) -> None:
            for online_parameter, target_parameter in zip(
                self.online.parameters(), self.target.parameters(), strict=True
            ):
                target_parameter.mul_(config.ema_decay).add_(
                    online_parameter, alpha=1 - config.ema_decay
                )
            if config.architecture_version >= 2:
                for online_parameter, target_parameter in zip(
                    self.online_state.parameters(),
                    self.target_state.parameters(),
                    strict=True,
                ):
                    target_parameter.mul_(config.state_ema_decay).add_(
                        online_parameter, alpha=1 - config.state_ema_decay
                    )

        def _queued_state_keys(self):
            if config.architecture_version < 4:
                return None
            count = int(self.state_queue_count.item())
            return self.state_queue[:count]

        @torch.no_grad()
        def _enqueue_state_keys(self, keys) -> None:
            if config.state_queue_size == 0:
                return
            keys = functional.normalize(keys.detach(), dim=-1)
            if keys.shape[0] >= config.state_queue_size:
                self.state_queue.copy_(keys[-config.state_queue_size :])
                self.state_queue_pointer.zero_()
                self.state_queue_count.fill_(config.state_queue_size)
                return
            pointer = int(self.state_queue_pointer.item())
            count = int(self.state_queue_count.item())
            first_count = min(keys.shape[0], config.state_queue_size - pointer)
            self.state_queue[pointer : pointer + first_count].copy_(keys[:first_count])
            remaining = keys.shape[0] - first_count
            if remaining:
                self.state_queue[:remaining].copy_(keys[first_count:])
            self.state_queue_pointer.fill_((pointer + keys.shape[0]) % config.state_queue_size)
            self.state_queue_count.fill_(
                min(config.state_queue_size, count + keys.shape[0])
            )

        @torch.no_grad()
        def encode(self, video):
            tokens = self.target(video)
            if config.architecture_version == 1:
                return tokens.mean(dim=1)
            temporal_state = self.target_state(tokens)
            if config.architecture_version == 2:
                return temporal_state.mean(dim=1)
            return temporal_state[:, -1]

        @torch.no_grad()
        def encode_online(self, video):
            tokens = self.online(video)
            if config.architecture_version == 1:
                return tokens.mean(dim=1)
            temporal_state = self.online_state(tokens)
            if config.architecture_version == 2:
                return temporal_state.mean(dim=1)
            return temporal_state[:, -1]

        @torch.no_grad()
        def encode_token_grid(self, video):
            return self.target(video)

        @torch.no_grad()
        def encode_world_state(self, video):
            """Return the spatial-temporal token grid used by world-model stages."""
            return self.target(video)

        @torch.no_grad()
        def encode_online_token_grid(self, video):
            return self.online(video)

    return GameJepa()


def representation_variance_loss(states, target_std: float):
    torch, _, functional = _torch_modules()
    flattened = states.reshape(-1, states.shape[-1])
    standard_deviation = torch.sqrt(flattened.var(dim=0, unbiased=False) + 1e-4)
    return functional.relu(target_std - standard_deviation).mean()


def representation_covariance_loss(states):
    torch, _, _ = _torch_modules()
    flattened = states.reshape(-1, states.shape[-1])
    if flattened.shape[0] < 2:
        return flattened.new_zeros(())
    centered = flattened - flattened.mean(dim=0, keepdim=True)
    covariance = centered.T @ centered / (flattened.shape[0] - 1)
    diagonal = torch.diag(torch.diagonal(covariance))
    off_diagonal = covariance - diagonal
    return off_diagonal.square().sum() / flattened.shape[-1]


def representation_diversity_loss(states, similarity_ceiling: float):
    torch, _, functional = _torch_modules()
    if states.shape[0] < 2:
        return states.new_zeros(())
    normalized = functional.normalize(states, dim=-1)
    similarities = normalized @ normalized.T
    mask = ~torch.eye(states.shape[0], dtype=torch.bool, device=states.device)
    return functional.relu(similarities[mask] - similarity_ceiling).mean()


def state_contrastive_loss(queries, keys, queued_keys, temperature: float):
    torch, _, functional = _torch_modules()
    queries = functional.normalize(queries, dim=-1)
    keys = functional.normalize(keys.detach(), dim=-1)
    logits = queries @ keys.T
    if queued_keys is not None and queued_keys.shape[0] > 0:
        queued_keys = functional.normalize(queued_keys.detach(), dim=-1)
        logits = torch.cat([logits, queries @ queued_keys.T], dim=1)
    logits = logits / temperature
    labels = torch.arange(queries.shape[0], device=queries.device)
    loss = functional.cross_entropy(logits, labels)
    accuracy = (logits.argmax(dim=1) == labels).float().mean()
    return loss, accuracy


def build_action_dynamics(config: GameJepaConfig):
    _, nn, _ = _torch_modules()

    class ActionConditionedLatentDynamics(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.action_encoder = nn.Sequential(
                nn.Linear(config.action_dim + 1, config.embedding_dim),
                nn.GELU(),
                nn.LayerNorm(config.embedding_dim),
            )
            self.transition = nn.GRUCell(
                config.embedding_dim, config.embedding_dim
            )
            self.residual = nn.Sequential(
                nn.LayerNorm(config.embedding_dim),
                nn.Linear(config.embedding_dim, config.embedding_dim),
            )

        def forward(self, state, actions, delta_seconds):
            action = self.action_encoder(
                _torch_modules()[0].cat([actions, delta_seconds.unsqueeze(-1)], dim=-1)
            )
            hidden = self.transition(action, state)
            return hidden + self.residual(hidden)

        def rollout(self, initial_state, actions, delta_seconds):
            states = []
            state = initial_state
            for index in range(actions.shape[1]):
                state = self.forward(
                    state, actions[:, index], delta_seconds[:, index]
                )
                states.append(state)
            return _torch_modules()[0].stack(states, dim=1)

    return ActionConditionedLatentDynamics()


def build_token_grid_action_dynamics(config: GameJepaConfig):
    torch, nn, _ = _torch_modules()

    class TokenGridActionDynamics(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.action_encoder = nn.Sequential(
                nn.Linear(config.action_dim + 1, config.embedding_dim),
                nn.GELU(),
                nn.LayerNorm(config.embedding_dim),
            )
            self.transition = nn.GRUCell(
                config.embedding_dim, config.embedding_dim
            )
            self.spatial_mixer = nn.TransformerEncoderLayer(
                d_model=config.embedding_dim,
                nhead=config.heads,
                dim_feedforward=config.embedding_dim * 2,
                dropout=0.0,
                batch_first=True,
                norm_first=True,
                activation="gelu",
            )
            self.delta_head = nn.Sequential(
                nn.LayerNorm(config.embedding_dim),
                nn.Linear(config.embedding_dim, config.embedding_dim),
            )
            self.log_variance_head = nn.Sequential(
                nn.LayerNorm(config.embedding_dim),
                nn.Linear(config.embedding_dim, config.embedding_dim),
            )

        def forward(self, initial_grid, actions, delta_seconds):
            _validate_dynamics_shapes(initial_grid, actions, delta_seconds, config)
            state = initial_grid
            means = []
            log_variances = []
            for horizon_index in range(actions.shape[1]):
                action = self.action_encoder(
                    torch.cat(
                        [
                            actions[:, horizon_index],
                            delta_seconds[:, horizon_index].unsqueeze(-1),
                        ],
                        dim=-1,
                    )
                )
                token_count = state.shape[1]
                action_grid = action.unsqueeze(1).expand(-1, token_count, -1)
                hidden = self.transition(
                    action_grid.reshape(-1, config.embedding_dim),
                    state.reshape(-1, config.embedding_dim),
                ).reshape_as(state)
                hidden = self.spatial_mixer(hidden)
                mean = state + self.delta_head(hidden)
                log_variance = self.log_variance_head(hidden).clamp(-8.0, 4.0)
                means.append(mean)
                log_variances.append(log_variance)
                state = mean
            return {
                "mean": torch.stack(means, dim=1),
                "log_variance": torch.stack(log_variances, dim=1),
            }

        def rollout(self, initial_grid, actions, delta_seconds):
            return self.forward(initial_grid, actions, delta_seconds)

    return TokenGridActionDynamics()


def token_grid_dynamics_loss(
    prediction,
    target_grid,
    cosine_weight: float = 0.1,
    horizon_decay: float = 0.9,
):
    torch, _, functional = _torch_modules()
    mean = prediction["mean"]
    log_variance = prediction["log_variance"]
    if mean.shape != target_grid.shape or log_variance.shape != target_grid.shape:
        raise ValueError("Predicted and target token grids must have identical shapes")
    if not 0 < horizon_decay <= 1:
        raise ValueError("horizon_decay must be in (0, 1]")
    squared_error = (target_grid - mean).square()
    gaussian_nll = 0.5 * (
        torch.exp(-log_variance) * squared_error + log_variance
    ).mean(dim=(-1, -2))
    cosine = functional.cosine_similarity(mean, target_grid, dim=-1).mean(dim=-1)
    cosine_loss = 1 - cosine
    horizon = mean.shape[1]
    weights = torch.tensor(
        [horizon_decay**index for index in range(horizon)],
        device=mean.device,
        dtype=mean.dtype,
    )
    weights = weights / weights.sum()
    nll = (gaussian_nll * weights).sum(dim=1).mean()
    cosine_objective = (cosine_loss * weights).sum(dim=1).mean()
    loss = nll + cosine_weight * cosine_objective
    return {
        "loss": loss,
        "gaussian_nll": nll.detach(),
        "cosine_loss": cosine_objective.detach(),
        "mean_cosine_similarity": cosine.mean().detach(),
        "mean_predicted_std": torch.exp(0.5 * log_variance).mean().detach(),
        "per_horizon_mse": squared_error.mean(dim=(0, 2, 3)).detach(),
        "per_horizon_cosine_similarity": cosine.mean(dim=0).detach(),
    }


def _validate_dynamics_shapes(initial_grid, actions, delta_seconds, config) -> None:
    if initial_grid.ndim != 3:
        raise ValueError("initial_grid must have shape [batch, tokens, dimension]")
    if actions.ndim != 3 or actions.shape[-1] != config.action_dim:
        raise ValueError(
            f"actions must have shape [batch, horizon, {config.action_dim}]"
        )
    if delta_seconds.shape != actions.shape[:2]:
        raise ValueError("delta_seconds must have shape [batch, horizon]")
    if initial_grid.shape[0] != actions.shape[0]:
        raise ValueError("initial_grid and actions must have the same batch size")
    if initial_grid.shape[-1] != config.embedding_dim:
        raise ValueError(
            f"initial_grid dimension must be {config.embedding_dim}"
        )
    if actions.shape[1] == 0:
        raise ValueError("action horizon must be positive")


def random_token_mask(batch_size: int, token_count: int, ratio: float, device):
    torch, _, _ = _torch_modules()
    masked = max(1, min(token_count - 1, round(token_count * ratio)))
    noise = torch.rand(batch_size, token_count, device=device)
    indexes = noise.argsort(dim=1)[:, :masked]
    mask = torch.zeros(batch_size, token_count, dtype=torch.bool, device=device)
    mask.scatter_(1, indexes, True)
    return mask
