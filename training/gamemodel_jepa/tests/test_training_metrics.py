from leviathan_game_jepa.training import _representation_selection_gate


def metrics(cosine: float, rank: float, pairwise: float) -> dict:
    return {
        "masked_cosine_similarity": cosine,
        "token_grid_representation": {
            "effective_rank": rank,
            "mean_pairwise_cosine_similarity": pairwise,
        },
    }


def test_representation_gate_accepts_predictive_noncollapsed_grid() -> None:
    result = _representation_selection_gate(
        metrics(0.96, 56.1, 0.975), metrics(0.0, 55.3, 0.970)
    )

    assert result["passed"] is True
    assert all(result["checks"].values())


def test_representation_gate_rejects_poor_rank_retention() -> None:
    result = _representation_selection_gate(
        metrics(0.97, 22.9, 0.979), metrics(0.0, 44.1, 0.984)
    )

    assert result["passed"] is False
    assert result["checks"]["prediction_quality"] is True
    assert result["checks"]["token_grid_rank_retention"] is False
