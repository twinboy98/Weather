from __future__ import annotations

import asyncio
import random
import signal
from datetime import UTC, datetime

import structlog

from app.core.settings import get_settings
from app.storage.database import initialize_database

logger = structlog.get_logger()


class NowcastWorker:
    def __init__(self) -> None:
        self.running = True
        self.interval_seconds = 10 * 60

    def stop(self, *_: object) -> None:
        self.running = False

    async def run(self) -> None:
        initialize_database()
        settings = get_settings()
        logger.info("worker_started", demo_mode=settings.demo_mode)
        while self.running:
            started = datetime.now(UTC)
            # Phase 1 refreshes fixture data only. Live adapters remain policy-gated.
            logger.info("nowcast_refresh", started_at_utc=started.isoformat(), mode="demo")
            jitter = random.uniform(-30, 30)
            await asyncio.sleep(max(30, self.interval_seconds + jitter))
        logger.info("worker_stopped")


async def main() -> None:
    worker = NowcastWorker()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, worker.stop)
        except NotImplementedError:
            signal.signal(sig, worker.stop)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())

