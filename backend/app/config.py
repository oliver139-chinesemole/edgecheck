from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path
from functools import lru_cache


class Settings(BaseSettings):
    # Alpaca paper trading (optional)
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    alpaca_base_url: str = "https://paper-api.alpaca.markets"

    # Financial Modeling Prep (optional)
    fmp_api_key: str = ""

    # App config
    db_path: str = str(Path(__file__).parent.parent / "edgecheck.db")
    data_dir: str = str(Path(__file__).parent.parent.parent / "data")
    models_dir: str = str(Path(__file__).parent.parent.parent / "models")
    initial_capital: float = 100_000.0
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def has_alpaca(self) -> bool:
        return bool(self.alpaca_api_key and self.alpaca_secret_key)

    @property
    def has_fmp(self) -> bool:
        return bool(self.fmp_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
