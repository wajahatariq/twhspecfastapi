from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.routers import auth_router, transactions_router
from app.ws_manager import manager

# Paths
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(
    title="Client Management System API - Techware Hub",
    version="1.0.0",
)

# CORS (you can tighten allow_origins later for production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files (CSS, JS, images)
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


# Frontend routes
@app.get("/", response_class=FileResponse)
async def landing_page():
    """
    Landing page with Manager / Agent selection.
    """
    return FileResponse(str(FRONTEND_DIR / "home.html"))


@app.get("/manager", response_class=FileResponse)
async def manager_portal():
    """
    Manager portal UI.
    """
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/agent", response_class=FileResponse)
async def agent_portal():
    """
    Agent portal UI.
    """
    return FileResponse(str(FRONTEND_DIR / "agent.html"))


# Optional JSON health endpoint (for debugging / monitoring)
@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "Client Management System API is running"}


# Include API routers
app.include_router(auth_router.router)
app.include_router(transactions_router.router)


# WebSocket for manager live updates
@app.websocket("/ws/manager")
async def websocket_manager(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Keep connection alive; we do not currently use messages from client
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
