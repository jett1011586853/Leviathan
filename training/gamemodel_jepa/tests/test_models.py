import torch

from leviathan_game_jepa.models import GameJepaConfig, build_game_jepa


def config(version: int) -> GameJepaConfig:
    return GameJepaConfig(
        frames=4,
        height=32,
        width=32,
        embedding_dim=32,
        depth=1,
        heads=4,
        tubelet_size=2,
        patch_size=16,
        mask_ratio=0.5,
        ema_decay=0.99,
        action_dim=12,
        architecture_version=version,
        state_prediction_weight=0.25 if version >= 2 else 0.0,
        variance_weight=0.1 if version >= 2 else 0.0,
        covariance_weight=0.01 if version == 3 else (0.001 if version == 2 else 0.0),
        variance_target=0.5,
        state_diversity_weight=0.05 if version == 3 else 0.0,
        state_similarity_ceiling=0.9,
        state_ema_decay=0.95 if version >= 4 else 0.99,
        contrastive_weight=1.0 if version >= 4 else 0.0,
        contrastive_temperature=0.1,
        state_queue_size=16 if version >= 4 else 0,
    )


def test_v1_architecture_keeps_legacy_output_contract() -> None:
    model = build_game_jepa(config(1))
    output = model(torch.randn(2, 3, 4, 32, 32))

    assert output["pooled_state"].shape == (2, 32)
    assert "state_prediction_loss" not in output
    output["loss"].backward()


def test_v2_architecture_exposes_anti_collapse_metrics() -> None:
    model = build_game_jepa(config(2))
    video = torch.randn(2, 3, 4, 32, 32)
    output = model(video)

    assert output["pooled_state"].shape == (2, 32)
    assert output["state_prediction_loss"] >= 0
    assert output["variance_loss"] >= 0
    assert output["covariance_loss"] >= 0
    assert torch.isfinite(output["loss"])
    output["loss"].backward()
    model.update_target()
    assert model.encode(video).shape == (2, 32)


def test_v3_architecture_regularizes_video_level_state() -> None:
    model = build_game_jepa(config(3))
    video = torch.randn(4, 3, 4, 32, 32)
    output = model(video)

    assert output["pooled_state"].shape == (4, 32)
    assert output["state_diversity_loss"] >= 0
    assert torch.isfinite(output["loss"])
    output["loss"].backward()
    assert model.encode(video).shape == (4, 32)


def test_v4_architecture_uses_cross_batch_contrastive_queue() -> None:
    model = build_game_jepa(config(4))
    video = torch.randn(4, 3, 4, 32, 32)

    first = model(video)
    first["loss"].backward()
    assert first["contrastive_loss"] >= 0
    assert 0 <= first["contrastive_accuracy"] <= 1
    assert int(model.state_queue_count) == 4

    model.zero_grad(set_to_none=True)
    second = model(torch.randn_like(video))
    second["loss"].backward()
    assert int(model.state_queue_count) == 8
    model.eval()
    model(torch.randn_like(video))
    assert int(model.state_queue_count) == 8
    assert model.encode(video).shape == (4, 32)
    assert model.encode_online(video).shape == (4, 32)
    assert model.encode_token_grid(video).shape == (4, 8, 32)
    assert model.encode_world_state(video).shape == (4, 8, 32)
    assert model.encode_online_token_grid(video).shape == (4, 8, 32)


def test_legacy_experiment_defaults_do_not_require_a_queue() -> None:
    legacy = {
        "clip": {"frames": 4, "height": 32, "width": 32},
        "model": {
            "embedding_dim": 32,
            "depth": 1,
            "heads": 4,
            "tubelet_size": 2,
            "patch_size": 16,
            "mask_ratio": 0.5,
            "ema_decay": 0.99,
            "action_dim": 12,
        },
    }

    parsed = GameJepaConfig.from_experiment(legacy)

    assert parsed.architecture_version == 1
    assert parsed.state_ema_decay == parsed.ema_decay
    assert parsed.contrastive_weight == 0
    assert parsed.state_queue_size == 0
