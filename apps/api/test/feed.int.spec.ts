import { FEED_LIMITS, type LikeResult, type Paginated, type PollDto, type PostCommentDto, type PostDto, type ReportDto } from '@autoc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/common/ids';
import { bearer, createCommunity, createTestApp, createUser, makeFriends, waitFor, type TestApp } from './support/app';
import { pngImage } from './support/images';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

type U = { id: string; token: string };

const api = (u: U) => ({
  post: (b: object) => request(t.http).post('/api/v1/posts').set(bearer(u.token)).send(b),
  get: (id: string) => request(t.http).get(`/api/v1/posts/${id}`).set(bearer(u.token)),
  del: (id: string) => request(t.http).delete(`/api/v1/posts/${id}`).set(bearer(u.token)),
  feed: (q = '') => request(t.http).get(`/api/v1/feed${q}`).set(bearer(u.token)),
  like: (id: string) => request(t.http).post(`/api/v1/posts/${id}/like`).set(bearer(u.token)),
  unlike: (id: string) => request(t.http).delete(`/api/v1/posts/${id}/like`).set(bearer(u.token)),
  comments: (id: string, q = '') => request(t.http).get(`/api/v1/posts/${id}/comments${q}`).set(bearer(u.token)),
  comment: (id: string, text: string) => request(t.http).post(`/api/v1/posts/${id}/comments`).set(bearer(u.token)).send({ text }),
  delComment: (id: string) => request(t.http).delete(`/api/v1/comments/${id}`).set(bearer(u.token)),
  vote: (id: string, optionIds: string[]) => request(t.http).post(`/api/v1/posts/${id}/poll/vote`).set(bearer(u.token)).send({ optionIds }),
  report: (targetType: string, targetId: string) =>
    request(t.http).post('/api/v1/reports').set(bearer(u.token)).send({ targetType, targetId, reason: 'spam' }),
});

/** An upload row owned by `ownerId` (the file itself isn't needed by the feed). */
async function upload(ownerId: string, purpose: string): Promise<string> {
  const id = newId();
  await t.prisma.upload.create({
    data: { id, ownerId, purpose, key: `${purpose}/test/${id}.webp`, mime: purpose === 'video' ? 'video/mp4' : 'image/webp', sizeBytes: 100, width: 10, height: 10 },
  });
  return id;
}

const ids = (page: Paginated<PostDto>) => page.items.map((p) => p.id);

describe('posts: validation and media', () => {
  it('needs text, media or a poll; enforces limits', async () => {
    const me = await createUser(t);
    const bad = [
      {},
      { text: '   ' },
      { text: 'x'.repeat(FEED_LIMITS.textMax + 1) },
      { poll: { question: 'ab', options: ['a', 'b'] } },
      { poll: { question: 'Куда едем?', options: ['Только один'] } },
      { poll: { question: 'Куда едем?', options: ['1', '2', '3', '4', '5', '6', '7'] } },
      { poll: { question: 'Куда едем?', options: ['Медеу', 'медеу'] } },
      { poll: { question: 'Куда едем?', options: ['Медеу', 'x'.repeat(81)] } },
      { poll: { question: 'Куда едем?', options: ['Медеу', ''] } },
      { mediaUploadIds: Array.from({ length: 7 }, () => newId()) },
      { text: 'x', communityId: 'nope' },
    ];
    for (const b of bad) expect((await api(me).post(b).expect(400)).body.error.code, JSON.stringify(b).slice(0, 60)).toBe('VALIDATION_ERROR');

    const text = (await api(me).post({ text: '  Привет, водители!  ' }).expect(201)).body as PostDto;
    expect(text).toMatchObject({ text: 'Привет, водители!', media: [], poll: null, community: null, likeCount: 0, commentCount: 0, likedByMe: false, canDelete: true });
    const poll = (await api(me).post({ poll: { question: 'Куда едем в субботу?', options: ['Медеу', 'Капчагай'], multiple: true } }).expect(201)).body as PostDto;
    expect(poll.text).toBe('');
    expect(poll.poll).toMatchObject({ question: 'Куда едем в субботу?', multiple: true, myVotes: [], totalVoters: 0 });
    expect(poll.poll!.options.map((o) => [o.text, o.voteCount])).toEqual([
      ['Медеу', 0],
      ['Капчагай', 0],
    ]);
  });

  it('media: own `post` images (≤ 6) or exactly one own `video`; one post per upload', async () => {
    const me = await createUser(t);
    const other = await createUser(t);
    // a real upload through the API
    const real = (
      await request(t.http).post('/api/v1/uploads?purpose=post').set(bearer(me.token)).attach('file', await pngImage(), 'p.png').expect(201)
    ).body as { id: string };
    const photos = [real.id, ...(await Promise.all(Array.from({ length: 5 }, () => upload(me.id, 'post'))))];
    const post = (await api(me).post({ text: 'Фото с выезда', mediaUploadIds: photos }).expect(201)).body as PostDto;
    expect(post.media.map((m) => m.id)).toEqual(photos);
    expect(post.media[0]!.url).toMatch(/^http/);
    // the same upload can't be attached twice
    expect((await api(me).post({ mediaUploadIds: [photos[0]] }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');

    const video = await upload(me.id, 'video');
    expect(((await api(me).post({ mediaUploadIds: [video] }).expect(201)).body as PostDto).media).toHaveLength(1);
    expect((await api(me).post({ mediaUploadIds: [await upload(me.id, 'video'), await upload(me.id, 'post')] }).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await api(me).post({ mediaUploadIds: [await upload(other.id, 'post')] }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    expect((await api(me).post({ mediaUploadIds: [await upload(me.id, 'message')] }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
    expect((await api(me).post({ mediaUploadIds: [newId()] }).expect(400)).body.error.code).toBe('INVALID_UPLOAD');
  });

  it('community posts: members only; unknown / deleted community 404', async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const pending = await createUser(t);
    const outsider = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: member.id }, { userId: pending.id, status: 'pending' }]);
    const p = (await api(member).post({ text: 'В клубе', communityId: cid }).expect(201)).body as PostDto;
    expect(p.community).toMatchObject({ id: cid });
    await api(pending).post({ text: 'x', communityId: cid }).expect(403);
    await api(outsider).post({ text: 'x', communityId: cid }).expect(403);
    await api(member).post({ text: 'x', communityId: newId() }).expect(404);
    const gone = await createCommunity(t, owner.id, [], { deleted: true });
    await api(owner).post({ text: 'x', communityId: gone }).expect(404);
  });
});

describe('feed scopes and visibility', () => {
  it('all / communities / friends, private communities hidden from outsiders, filters, pagination', async () => {
    const viewer = await createUser(t);
    const friend = await createUser(t);
    const stranger = await createUser(t);
    await makeFriends(t, viewer.id, friend.id);
    const pub = await createCommunity(t, stranger.id, [{ userId: friend.id }]);
    const privOther = await createCommunity(t, stranger.id, [{ userId: friend.id }], { isPrivate: true });
    const privMine = await createCommunity(t, stranger.id, [{ userId: viewer.id }, { userId: friend.id }], { isPrivate: true });
    const pubMine = await createCommunity(t, stranger.id, [{ userId: viewer.id }]);

    const make = async (u: U, communityId?: string) => ((await api(u).post({ text: `p-${newId()}`, communityId }).expect(201)).body as PostDto).id;
    const globalStranger = await make(stranger);
    const globalFriend = await make(friend);
    const inPub = await make(stranger, pub);
    const inPrivOther = await make(friend, privOther);
    const inPrivMine = await make(friend, privMine);
    const inPubMine = await make(stranger, pubMine);
    const deleted = await make(stranger);
    await api(stranger).del(deleted).expect(204);

    const all = ids((await api(viewer).feed('?limit=50').expect(200)).body);
    expect(all.filter((id) => [globalStranger, globalFriend, inPub, inPrivOther, inPrivMine, inPubMine, deleted].includes(id))).toEqual([
      inPubMine,
      inPrivMine,
      inPub,
      globalFriend,
      globalStranger,
    ]);
    const communities = ids((await api(viewer).feed('?scope=communities&limit=50').expect(200)).body);
    expect(communities.filter((id) => [globalStranger, globalFriend, inPub, inPrivOther, inPrivMine, inPubMine].includes(id))).toEqual([inPubMine, inPrivMine]);
    const friends = ids((await api(viewer).feed('?scope=friends&limit=50').expect(200)).body);
    expect(friends.filter((id) => [globalStranger, globalFriend, inPub, inPrivOther, inPrivMine, inPubMine].includes(id))).toEqual([inPrivMine, globalFriend]);

    expect(ids((await api(viewer).feed(`?communityId=${pub}`).expect(200)).body)).toEqual([inPub]);
    expect(ids((await api(viewer).feed(`?communityId=${privMine}&scope=friends`).expect(200)).body)).toEqual([inPrivMine]);
    await api(viewer).feed(`?communityId=${privOther}`).expect(403);
    await api(viewer).feed(`?communityId=${newId()}`).expect(404);
    expect(ids((await api(viewer).feed(`?authorId=${friend.id}&limit=50`).expect(200)).body)).toEqual([inPrivMine, globalFriend]);
    await api(viewer).feed('?scope=everyone').expect(400);

    // direct reads follow the same visibility
    await api(viewer).get(inPrivOther).expect(404);
    await api(viewer).get(deleted).expect(404);
    await api(friend).get(inPrivOther).expect(200);

    // keyset pagination is stable
    const pages: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (await api(viewer).feed(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200)).body as Paginated<PostDto>;
      pages.push(...ids(page));
      cursor = page.nextCursor;
    } while (cursor);
    expect(pages).toEqual(ids((await api(viewer).feed('?limit=50').expect(200)).body));

    // a deleted community's posts disappear; losing membership hides private posts
    await t.prisma.communityMember.delete({ where: { communityId_userId: { communityId: privMine, userId: viewer.id } } });
    await api(viewer).get(inPrivMine).expect(404);
    await t.prisma.community.update({ where: { id: pub }, data: { deletedAt: new Date() } });
    await api(viewer).get(inPub).expect(404);
  });
});

describe('deleting posts', () => {
  it('author or community moderator; soft delete', async () => {
    const owner = await createUser(t);
    const mod = await createUser(t);
    const member = await createUser(t);
    const other = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: mod.id, role: 'moderator' }, { userId: member.id }, { userId: other.id }]);
    const inCommunity = (await api(member).post({ text: 'Продам шины', communityId: cid }).expect(201)).body as PostDto;
    expect(((await api(mod).get(inCommunity.id).expect(200)).body as PostDto).canDelete).toBe(true);
    expect(((await api(other).get(inCommunity.id).expect(200)).body as PostDto).canDelete).toBe(false);
    await api(other).del(inCommunity.id).expect(403);
    await api(mod).del(inCommunity.id).expect(204);
    expect((await t.prisma.post.findUniqueOrThrow({ where: { id: inCommunity.id } })).deletedAt).not.toBeNull();
    await api(member).get(inCommunity.id).expect(404);
    await api(mod).del(inCommunity.id).expect(404);

    // a global post: only its author (community moderators have no say)
    const global = (await api(member).post({ text: 'Глобальный' }).expect(201)).body as PostDto;
    await api(owner).del(global.id).expect(403);
    await api(member).del(global.id).expect(204);
    await api(member).del(newId()).expect(404);
  });
});

describe('comments', () => {
  it('ascending keyset, deletion rights, counters', async () => {
    const owner = await createUser(t);
    const mod = await createUser(t);
    const author = await createUser(t);
    const c1 = await createUser(t);
    const c2 = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: mod.id, role: 'moderator' }, { userId: author.id }, { userId: c1.id }]);
    const post = (await api(author).post({ text: 'Кто знает хороший шиномонтаж?', communityId: cid }).expect(201)).body as PostDto;

    const first = (await api(c1).comment(post.id, '  На Рыскулова  ').expect(201)).body as PostCommentDto;
    expect(first).toMatchObject({ postId: post.id, text: 'На Рыскулова', canDelete: true, author: { id: c1.id } });
    const second = (await api(c2).comment(post.id, 'Плюсую').expect(201)).body as PostCommentDto;
    const third = (await api(author).comment(post.id, 'Спасибо!').expect(201)).body as PostCommentDto;
    await api(c1).comment(post.id, '   ').expect(400);
    await api(c1).comment(post.id, 'x'.repeat(1001)).expect(400);
    await api(c1).comment(newId(), 'x').expect(404);

    const page1 = (await api(c2).comments(post.id, '?limit=2').expect(200)).body as Paginated<PostCommentDto>;
    expect(page1.items.map((c) => c.id)).toEqual([first.id, second.id]);
    expect(page1.items.map((c) => c.canDelete)).toEqual([false, true]);
    const page2 = (await api(c2).comments(post.id, `?limit=2&cursor=${page1.nextCursor}`).expect(200)).body as Paginated<PostCommentDto>;
    expect(page2.items.map((c) => c.id)).toEqual([third.id]);
    expect(page2.nextCursor).toBeNull();
    expect(((await api(c2).get(post.id).expect(200)).body as PostDto).commentCount).toBe(3);

    // rights: comment author, post author, community moderator
    await api(c2).delComment(first.id).expect(403);
    await api(author).delComment(first.id).expect(204);
    await api(mod).delComment(second.id).expect(204);
    await api(c1).delComment(third.id).expect(403);
    await api(c1).delComment(first.id).expect(404);
    await api(c1).delComment(newId()).expect(404);
    expect(((await api(c2).comments(post.id).expect(200)).body as Paginated<PostCommentDto>).items.map((c) => c.id)).toEqual([third.id]);
    expect(((await api(c2).get(post.id).expect(200)).body as PostDto).commentCount).toBe(1);
  });

  it('post_comment: to the post author, not for own comments, one per post per 10 minutes', async () => {
    const author = await createUser(t);
    const a = await createUser(t, { name: 'Асель' });
    const b = await createUser(t);
    const post = (await api(author).post({ text: 'Фото с Медеу' }).expect(201)).body as PostDto;
    const count = () => t.prisma.notification.count({ where: { userId: author.id, type: 'post_comment' } });
    await api(author).comment(post.id, 'мой комментарий').expect(201);
    const c = (await api(a).comment(post.id, 'Красота!').expect(201)).body as PostCommentDto;
    await waitFor(async () => (await count()) === 1);
    await api(b).comment(post.id, 'Согласен').expect(201);
    await api(a).comment(post.id, 'Ещё раз').expect(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(await count()).toBe(1);
    const n = await t.prisma.notification.findFirstOrThrow({ where: { userId: author.id, type: 'post_comment' } });
    expect(n.payload).toMatchObject({ postId: post.id, commentId: c.id, preview: 'Красота!', user: { id: a.id, name: 'Асель' } });
    // the window is per post and expires
    await t.redis.del(`notify:post_comment:${post.id}`);
    await api(b).comment(post.id, 'Через 10 минут').expect(201);
    await waitFor(async () => (await count()) === 2);
  });
});

describe('likes', () => {
  it('idempotent like / unlike with counters; post_like throttled to one per post per hour', async () => {
    const author = await createUser(t);
    const fans = await Promise.all([createUser(t), createUser(t), createUser(t)]);
    const post = (await api(author).post({ text: 'Новые диски' }).expect(201)).body as PostDto;
    const notes = () => t.prisma.notification.count({ where: { userId: author.id, type: 'post_like' } });

    expect((await api(fans[0]!).like(post.id).expect(200)).body as LikeResult).toEqual({ likeCount: 1, likedByMe: true });
    expect((await api(fans[0]!).like(post.id).expect(200)).body as LikeResult).toEqual({ likeCount: 1, likedByMe: true });
    await waitFor(async () => (await notes()) === 1);
    await Promise.all(fans.slice(1).map((f) => api(f).like(post.id).expect(200)));
    expect(((await api(author).get(post.id).expect(200)).body as PostDto).likeCount).toBe(3);
    expect(((await api(fans[1]!).get(post.id).expect(200)).body as PostDto).likedByMe).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(await notes()).toBe(1);
    await api(author).like(post.id).expect(200); // own like: no notification
    expect((await api(fans[0]!).unlike(post.id).expect(200)).body as LikeResult).toEqual({ likeCount: 3, likedByMe: false });
    expect((await api(fans[0]!).unlike(post.id).expect(200)).body as LikeResult).toEqual({ likeCount: 3, likedByMe: false });
    await api(fans[0]!).like(newId()).expect(404);
    await new Promise((r) => setTimeout(r, 100));
    expect(await notes()).toBe(1);
  });
});

describe('polls', () => {
  it('single choice: one option, votes are final; results and myVotes', async () => {
    const author = await createUser(t);
    const [a, b] = await Promise.all([createUser(t), createUser(t)]);
    const post = (await api(author).post({ text: 'Опрос', poll: { question: 'Лучшая резина на зиму?', options: ['Nokian', 'Michelin', 'Pirelli'] } }).expect(201)).body as PostDto;
    const [o1, o2, o3] = post.poll!.options.map((o) => o.id);
    expect((await api(a).vote(post.id, [o1!, o2!]).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await api(a).vote(post.id, [newId()]).expect(400)).body.error.code).toBe('INVALID_OPTION');
    await api(a).vote(post.id, []).expect(400);
    const after = (await api(a).vote(post.id, [o2!]).expect(200)).body as PollDto;
    expect(after).toMatchObject({ myVotes: [o2], totalVoters: 1 });
    expect(after.options.map((o) => o.voteCount)).toEqual([0, 1, 0]);
    expect((await api(a).vote(post.id, [o3!]).expect(409)).body.error.code).toBe('ALREADY_VOTED');
    await api(b).vote(post.id, [o2!]).expect(200);
    const seen = ((await api(author).get(post.id).expect(200)).body as PostDto).poll!;
    expect(seen).toMatchObject({ myVotes: [], totalVoters: 2 });
    expect(seen.options.map((o) => o.voteCount)).toEqual([0, 2, 0]);
    const noPoll = (await api(author).post({ text: 'Без опроса' }).expect(201)).body as PostDto;
    await api(a).vote(noPoll.id, [o1!]).expect(404);
  });

  it('multiple choice in one vote; concurrent votes count once per user', async () => {
    const author = await createUser(t);
    const voters = await Promise.all(Array.from({ length: 5 }, () => createUser(t)));
    const post = (await api(author).post({ poll: { question: 'Что взять в поездку?', options: ['Трос', 'Компрессор', 'Канистра'], multiple: true } }).expect(201)).body as PostDto;
    const [o1, o2, o3] = post.poll!.options.map((o) => o.id);
    const mine = (await api(voters[0]!).vote(post.id, [o1!, o3!]).expect(200)).body as PollDto;
    expect([...mine.myVotes].sort()).toEqual([o1, o3].sort());
    // the same user firing several votes at once: exactly one succeeds
    const burst = await Promise.all([api(voters[1]!).vote(post.id, [o1!]), api(voters[1]!).vote(post.id, [o2!]), api(voters[1]!).vote(post.id, [o2!, o3!])]);
    expect(burst.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    // different users at once: all counted
    await Promise.all(voters.slice(2).map((v) => api(v).vote(post.id, [o2!]).expect(200)));
    const poll = ((await api(author).get(post.id).expect(200)).body as PostDto).poll!;
    expect(poll.totalVoters).toBe(5);
    const votes = await t.prisma.pollVote.groupBy({ by: ['optionId'], _count: { _all: true }, where: { pollId: (await t.prisma.poll.findUniqueOrThrow({ where: { postId: post.id } })).id } });
    const byOption = new Map(votes.map((v) => [v.optionId, v._count._all]));
    expect(poll.options.map((o) => o.voteCount)).toEqual([o1, o2, o3].map((id) => byOption.get(id!) ?? 0));
    const burstVotes = (burst.find((r) => r.status === 200)!.body as PollDto).myVotes.length;
    expect(poll.options.reduce((sum, o) => sum + o.voteCount, 0)).toBe(2 + burstVotes + 3);
  });
});

describe('rate limits', () => {
  it(`${FEED_LIMITS.postsPerDay} posts per day and ${FEED_LIMITS.commentsPerHour} comments per hour`, async () => {
    const me = await createUser(t);
    for (let i = 0; i < FEED_LIMITS.postsPerDay; i++) await api(me).post({ text: `post ${i}` }).expect(201);
    const limited = await api(me).post({ text: 'one more' }).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeTruthy();

    const other = await createUser(t);
    const post = (await api(other).post({ text: 'обсуждение' }).expect(201)).body as PostDto;
    for (let i = 0; i < FEED_LIMITS.commentsPerHour; i++) await api(me).comment(post.id, `c${i}`).expect(201);
    expect((await api(me).comment(post.id, 'too many').expect(429)).body.error.code).toBe('RATE_LIMITED');
  });
});

describe('reports on posts and comments', () => {
  it('visible targets only; resolves the author; own content rejected', async () => {
    const owner = await createUser(t);
    const member = await createUser(t);
    const outsider = await createUser(t);
    const cid = await createCommunity(t, owner.id, [{ userId: member.id }], { isPrivate: true });
    const priv = (await api(member).post({ text: 'Только для своих', communityId: cid }).expect(201)).body as PostDto;
    const pub = (await api(member).post({ text: 'Спам-реклама' }).expect(201)).body as PostDto;
    const comment = (await api(owner).comment(priv.id, 'грубость').expect(201)).body as PostCommentDto;
    const pubComment = (await api(owner).comment(pub.id, 'спам').expect(201)).body as PostCommentDto;

    const r = (await api(owner).report('post', priv.id).expect(201)).body as ReportDto;
    expect(r).toMatchObject({ targetType: 'post', targetId: priv.id, status: 'open' });
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: r.id } })).targetUserId).toBe(member.id);
    await api(outsider).report('post', priv.id).expect(404);
    await api(outsider).report('comment', comment.id).expect(404);
    expect((await api(member).report('post', pub.id).expect(400)).body.error.code).toBe('INVALID_TARGET');
    expect((await api(owner).report('comment', pubComment.id).expect(400)).body.error.code).toBe('INVALID_TARGET');
    const rc = (await api(member).report('comment', comment.id).expect(201)).body as ReportDto;
    expect((await t.prisma.report.findUniqueOrThrow({ where: { id: rc.id } })).targetUserId).toBe(owner.id);
    expect((await api(member).report('comment', comment.id).expect(409)).body.error.code).toBe('ALREADY_REPORTED');
    await api(outsider).report('comment', pubComment.id).expect(201);
    // deleted content is gone for reporters too
    await api(owner).delComment(pubComment.id).expect(204);
    await api(member).report('comment', pubComment.id).expect(404);
    await api(member).del(pub.id).expect(204);
    await api(outsider).report('post', pub.id).expect(404);
  });
});
