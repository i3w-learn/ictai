import { useEffect, useRef, useState, type RefObject } from 'react';
import { SHOW_BEAT_MS, Show, showRoom, type ShowKind, type ShowStart, type ShowUpdate } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { useAction, useLatest } from '../../ui/ui';
import { startingPlace } from './show-pages';
import { tk, useT } from '../../i18n/i18n';

// The teacher's side of one show: start it, keep it alive, turn its pages, give the pen, stop it.
// `start` says what to show. For a video, `peek` asks the player where it is right now; its play,
// pause and skip are sent with `tell`.
//
// Pages: `turn` may be called before the show starts too (the teacher reading ahead). The page is
// remembered and sent as soon as there is a show, and again every few seconds while showing, so the
// class's screens are put right if a message was lost, and the server keeps saying who is watching.
export function useShowHost(start: ShowStart, peek?: RefObject<(() => ShowUpdate) | null>) {
  const { call, keepAlive, relay, present } = useApp();
  const t = useT();
  const what = useLatest(start);
  const [showing, setShowing] = useState(false);
  const showId = useRef<string | null>(null);
  const kind = useRef<ShowKind | null>(null);
  // The show as the server last described it: who is watching, who has the pen, how much is written.
  const [live, setLive] = useState<Show | null>(null);
  // The page the teacher is on, and how many pages there are once counted.
  const where = useRef<{ page: number; pages?: number }>({ page: 1 });
  // Counts page messages, so an answer to an older one never puts back an older page.
  const sent = useRef(0);
  const [pageError, setPageError] = useState<string | null>(null);

  const ended = () => { showId.current = null; kind.current = null; setShowing(false); setLive(null); setPageError(null); };
  // A call about show `id` failed. Says whether it was dealt with here.
  const lost = (e: unknown, id: string): boolean => {
    if (!(e instanceof ApiCallError) || showId.current !== id) return false;
    // Someone else is now showing this class something: stop saying this show is on.
    if (e.status === 410) { ended(); return true; }
    // The server no longer knows the show (the Server PC was away for a while, or restarted) but the
    // teacher never stopped it: start it again, at the place her video or her page is now. A whiteboard
    // starts again blank, at page 1 of 1: its writing went with the server's memory.
    if (e.status === 404) {
      showId.current = null;
      call('POST /api/v1/shows', { body: what.current }).then(
        (again) => { showId.current = again.id; kind.current = again.kind; where.current = startingPlace(again.kind, where.current); setLive(again); refresh(); },
        () => ended(),
      );
      return true;
    }
    return false;
  };
  const tell = (s: ShowUpdate) => {
    const id = showId.current;
    if (!id) return;
    call('PUT /api/v1/shows/:id', { params: { id }, body: s }).then((now) => { if (showId.current === id) setLive(now); }, (e) => { lost(e, id); });
  };
  const sendPage = () => {
    const id = showId.current;
    if (!id) return;
    const n = ++sent.current;
    const { page, pages } = where.current;
    call('PUT /api/v1/shows/:id/page', { params: { id }, body: pages ? { page, pages } : { page } }).then(
      (now) => { if (showId.current === id && sent.current === n) { setLive(now); setPageError(null); } },
      (e) => {
        if (lost(e, id) || showId.current !== id || sent.current !== n) return;
        setPageError(e instanceof Error ? e.message : tk('The class could not be moved to this page.'));
      },
    );
  };
  // Tells the server everything about where the teacher is: the video's place, or the page.
  const refresh = () => {
    if (kind.current === 'video') { const s = peek?.current?.(); if (s) tell(s); }
    else if (kind.current) sendPage();
  };
  const refreshNow = useLatest(refresh);

  const startShow = useAction(async () => {
    const s = await call('POST /api/v1/shows', { body: what.current });
    showId.current = s.id;
    kind.current = s.kind;
    where.current = startingPlace(s.kind, where.current);
    setLive(s);
    setShowing(true);
    setPageError(null);
    refresh();
  });
  const stopShow = useAction(async () => {
    const id = showId.current;
    ended();
    if (id) await call('DELETE /api/v1/shows/:id', { params: { id } });
  });
  const givePen = useAction(async (studentId: string | null) => {
    const id = showId.current;
    if (id) setLive(await call('PUT /api/v1/shows/:id/pen', { params: { id }, body: { studentId } }));
  });
  // "Not now" to a student who asked. Her name leaves the list here at once; the class's room then
  // brings the server's own word on it.
  const refusePen = useAction(async (studentId: string) => {
    const id = showId.current;
    if (!id) return;
    await call('DELETE /api/v1/shows/:id/pen/asks/:studentId', { params: { id, studentId } });
    setLive((now) => (now && now.id === id ? { ...now, asks: now.asks?.filter((a) => a.studentId !== studentId) } : now));
  });
  const turn = (page: number, pages?: number) => {
    where.current = { page, pages: pages ?? where.current.pages };
    sendPage();
  };

  // While showing, the server hears from this screen every few seconds, so it knows the teacher is
  // still here; and the class's screens are put right if one has drifted.
  useEffect(() => {
    if (!showing) return;
    const timer = setInterval(() => refreshNow.current(), SHOW_BEAT_MS);
    return () => clearInterval(timer);
  }, [showing, refreshNow]);
  // While showing, listen to the class's room too: a student asking for the pen shows up at once,
  // not at the next "still here".
  const classId = showing ? live?.classId : undefined;
  useEffect(() => {
    if (!classId) return;
    return relay.subscribe(showRoom(classId), (state) => {
      const parsed = Show.nullable().safeParse(state);
      if (parsed.success && parsed.data && parsed.data.id === showId.current) setLive(parsed.data);
    });
  }, [relay, classId]);
  // And the app itself says "still here", because this page's own timer is slowed down, sometimes to
  // once a minute, when the window is hidden or covered (the teacher has another program in front).
  const liveId = showing ? live?.id : undefined;
  useEffect(() => {
    if (!liveId) return;
    keepAlive({ key: 'POST /api/v1/shows/:id/beat', input: { params: { id: liveId } } }, SHOW_BEAT_MS);
    return () => keepAlive(null);
  }, [keepAlive, liveId]);
  // The board window, when it is open, shows what the class is shown.
  useEffect(() => present?.setShow(showing ? live : null), [present, showing, live]);
  useEffect(() => () => present?.setShow(null), [present]);
  // Leaving the screen ends the show.
  useEffect(() => () => { const id = showId.current; if (id) void call('DELETE /api/v1/shows/:id', { params: { id } }).catch(() => undefined); }, [call]);

  return {
    showing,
    live,
    start: startShow.run,
    stop: stopShow.run,
    turn,
    givePen: givePen.run,
    refusePen: refusePen.run,
    error: startShow.error ?? stopShow.error ?? givePen.error ?? refusePen.error ?? (pageError && t(pageError)),
    tell,
    busy: { start: startShow.busy, stop: stopShow.busy, pen: givePen.busy || refusePen.busy },
  };
}

export type ShowHost = ReturnType<typeof useShowHost>;
