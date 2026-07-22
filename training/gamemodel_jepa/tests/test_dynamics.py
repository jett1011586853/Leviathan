import pytest
import torch

from leviathan_game_jepa.models import (
    build_token_grid_action_dynamics,
    token_grid_dynamics_loss,
)

from test_models import config


def test_token_grid_dynamics_rolls_out_mean_and_uncertainty() -> None:
    model_config = config(1)
    model = build_token_grid_action_dynamics(model_config)
    initial = torch.randn(2, model_config.token_count, model_config.embedding_dim)
    actions = torch.randn(2, 3, model_config.action_dim).clamp(-1, 1)
    delta_seconds = torch.full((2, 3), 1 / 20)
    target = torch.randn(2, 3, model_config.token_count, model_config.embedding_dim)

    prediction = model(initial, actions, delta_seconds)
    metrics = token_grid_dynamics_loss(prediction, target)

    assert prediction["mean"].shape == target.shape
    assert prediction["log_variance"].shape == target.shape
    assert metrics["per_horizon_mse"].shape == (3,)
    assert metrics["per_horizon_cosine_similarity"].shape == (3,)
    assert torch.isfinite(metrics["loss"])
    metrics["loss"].backward()


def test_token_grid_dynamics_rejects_misaligned_horizon() -> None:
    model_config = config(1)
    model = build_token_grid_action_dynamics(model_config)

    with pytest.raises(ValueError, match="delta_seconds"):
        model(
            torch.randn(2, model_config.token_count, model_config.embedding_dim),
            torch.randn(2, 3, model_config.action_dim),
            torch.randn(2, 2),
        )


def test_token_grid_dynamics_loss_rejects_invalid_decay() -> None:
    target = torch.randn(1, 2, 4, 8)
    prediction = {"mean": target.clone(), "log_variance": torch.zeros_like(target)}

    with pytest.raises(ValueError, match="horizon_decay"):
        token_grid_dynamics_loss(prediction, target, horizon_decay=0)
