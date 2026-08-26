from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db, sync as sync_module
from .routers import categories, daily, settings, sync, tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect_and_init()
    # Backup/mirror nodes run the sync engine; a host with a buddy configured
    # runs the encrypted-snapshot job; a plain single-node install runs neither.
    background = sync_module.start_background_tasks()
    yield
    for t in background:
        t.cancel()
    await db.close()


app = FastAPI(title="Streak API", lifespan=lifespan)

# Same-origin in production (nginx proxies /api); CORS kept open for local dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(categories.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(daily.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(sync.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"ok": True}
