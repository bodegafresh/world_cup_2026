import argparse
import asyncio
import json

from app.db.session import engine
from app.jobs.registry import run_registered_job


async def main_async(job_name: str) -> None:
    if engine is None:
        raise RuntimeError("DATABASE_URL is not configured")
    async with engine.begin() as conn:
        result = await run_registered_job(job_name, conn)
    print(json.dumps(result, indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("job_name")
    args = parser.parse_args()
    asyncio.run(main_async(args.job_name))


if __name__ == "__main__":
    main()

