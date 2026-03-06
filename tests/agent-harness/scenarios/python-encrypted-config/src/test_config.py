"""Visible tests for the config loading system."""
from config import init_service


DEFAULTS = {
    "rate_limit": "20/min",
    "cache_ttl": "2m",
    "log_level": "INFO",
    "max_connections": "50",
    "region": "us-east-1",
}


def test_env_overrides_defaults():
    """Environment variables correctly take precedence over defaults."""
    env = {"rate_limit": "600/min", "log_level": "DEBUG"}
    service = init_service(DEFAULTS, env, {})
    # 600 requests / 60 seconds = 10.0 rps
    assert abs(service["max_rps"] - 10.0) < 0.01, (
        f"Expected max_rps=10.0 (from env '600/min'), got {service['max_rps']:.4f}"
    )
    assert service["log_level"] == "DEBUG"


def test_defaults_apply_when_no_overrides():
    """Default values apply when no env or file overrides exist."""
    service = init_service(DEFAULTS, {}, {})
    # 20 requests / 60 seconds ≈ 0.333 rps
    assert abs(service["max_rps"] - 20 / 60) < 0.01, (
        f"Expected max_rps≈{20/60:.4f} (from defaults '20/min'), got {service['max_rps']:.4f}"
    )
    assert service["log_level"] == "INFO"


def test_returns_service_descriptor():
    """init_service returns a dict with expected keys."""
    service = init_service(DEFAULTS, {}, {})
    assert "max_rps" in service
    assert "cache_ttl" in service
    assert "log_level" in service
    assert "cache_key" in service
