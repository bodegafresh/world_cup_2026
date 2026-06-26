from typing import Any

from app.clients.base import HttpClient
from app.core.config import get_settings


class SportmonksClient(HttpClient):
    source = "SPORTMONKS"

    def __init__(self) -> None:
        super().__init__("https://api.sportmonks.com/v3")
        self.token = get_settings().sportmonks_api_token

    def auth_params(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        out = dict(params or {})
        if self.token:
            out["api_token"] = self.token
        return out

    async def countries(self, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        return await self.get("core/countries", params=self.auth_params({"page": page, "per_page": per_page}))

    async def players_by_country(self, country_id: int, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        return await self.get(f"football/players/countries/{country_id}", params=self.auth_params({"page": page, "per_page": per_page}))

