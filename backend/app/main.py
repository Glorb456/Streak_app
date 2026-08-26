from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .routers import categories, daily, settings, tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect_and_init()
    yield
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


@app.get("/api/health")
async def health():
    return {"ok": True}
