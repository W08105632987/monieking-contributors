import asyncio

from app.core import redis_client


def test_new_event_loop_gets_new_client():
    seen = []

    async def grab():
        seen.append(redis_client.get_redis())
        seen.append(redis_client.get_redis())

    asyncio.run(grab())
    asyncio.run(grab())
    assert seen[0] is seen[1]          # same loop: reused
    assert seen[2] is seen[3]
    assert seen[1] is not seen[2]      # new loop (a new Celery task): fresh client
