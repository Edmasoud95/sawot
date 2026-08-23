"""REST endpoints for the model manager (list + download)."""

from fastapi import HTTPException

from server.models import get_model, is_downloaded, manager


def register_model_routes(app) -> None:
    @app.get("/api/models")
    async def list_models():
        return {"models": manager.all_status()}

    @app.post("/api/models/{kind}/{model_id}/download")
    async def start_download(kind: str, model_id: str):
        spec = get_model(kind, model_id)
        if spec is None:
            raise HTTPException(404, f"unknown model: {kind}/{model_id}")
        if is_downloaded(spec):
            return {"ok": True, "state": "downloaded"}
        manager.start(spec)
        return {"ok": True, "state": "downloading"}
