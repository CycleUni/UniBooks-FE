import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { MessageService } from './message.service';

// A hub token is valid for two hours. Reconnecting with the cached copy of it
// therefore stops working on any tab left open longer than that: every retry
// 401s, the hub stays down, and CFEdgeChat — which decides who is "away" by
// whether their hub has a socket — starts emailing the user about messages
// arriving in the page they are currently looking at.
describe('MessageService hub reconnect', () => {
  let service: MessageService;
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  let sockets: FakeWebSocket[];

  class FakeWebSocket {
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    readyState = 1;
    constructor(public url: string, public protocols?: string[]) {
      sockets.push(this);
    }
    close() { this.readyState = 3; }
    send() {}
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    (globalThis as any).WebSocket = FakeWebSocket;

    http = {
      // The hub snapshot fetched on open, and the fresh hub token below, are
      // the only two calls this test's paths make.
      get: vi.fn((url: string) =>
        url.includes('/messaging/hub-token/')
          ? of({ token: 'fresh-token', edge_chat_url: 'https://edge.example' })
          : of({ unread: [], lastReadAt: {}, count: 0 })
      ),
      post: vi.fn(() => of(undefined)),
    };

    TestBed.configureTestingModule({
      providers: [MessageService, { provide: HttpClient, useValue: http }],
    });
    service = TestBed.inject(MessageService);
    service.connectHub('stale-token', '42', 'https://edge.example');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function dropTheConnection() {
    sockets[sockets.length - 1].onclose?.();
    vi.advanceTimersByTime(60_000);
  }

  it('mints a fresh token instead of replaying the expired one', () => {
    expect(sockets[0].protocols).toEqual(['stale-token']);

    dropTheConnection();

    expect(http.get).toHaveBeenCalledWith('/messaging/hub-token/');
    expect(sockets).toHaveLength(2);
    expect(sockets[1].protocols).toEqual(['fresh-token']);
  });

  it('falls back to the cached token when the token request itself fails', () => {
    // Backend unreachable is the common case here (the network dropped, which
    // is why the socket closed) — retry with what we have rather than giving
    // up on the hub until the next page load.
    http.get.mockImplementation((url: string) =>
      url.includes('/messaging/hub-token/')
        ? throwError(() => new Error('offline'))
        : of({ unread: [], lastReadAt: {}, count: 0 })
    );

    dropTheConnection();

    expect(sockets).toHaveLength(2);
    expect(sockets[1].protocols).toEqual(['stale-token']);
  });

  it('does not reconnect after an intentional disconnect', () => {
    service.disconnectHub();
    sockets[sockets.length - 1].onclose?.();
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
  });
});
