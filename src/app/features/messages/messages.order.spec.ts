import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subject, of, EMPTY } from 'rxjs';
import { Messages } from './messages';
import { MessageService } from '../../core/services/message.service';
import { AuthStore } from '../../core/auth.store';
import { OrderService } from '../../core/services/order.service';
import { I18nService } from '../../core/i18n.service';
import { RegionService } from '../../core/region.service';

describe('Messages WebSocket ordering & temp-id reconciliation', () => {
  let fixture: ComponentFixture<Messages>;
  let component: Messages;
  let realTimeMessagesSubject: Subject<any>;
  let realTimeAcksSubject: Subject<any>;
  let mockMessageService: any;

  beforeEach(() => {
    realTimeMessagesSubject = new Subject();
    realTimeAcksSubject = new Subject();

    mockMessageService = {
      getConversations: vi.fn(() => of([])),
      getChatToken: vi.fn(() => of({ token: 'header.eyJ1c2VyX2lkIjoidXNlci0xIn0.sig', edge_chat_url: 'https://edge.example' })),
      getEdgeMessages: vi.fn(() => of([])),
      getEdgeMessagePage: vi.fn(() => of({ messages: [], has_more: false })),
      markConversationReadCF: vi.fn(() => of(undefined)),
      markRoomRead: vi.fn(),
      connectEdgeChat: vi.fn(),
      disconnectEdgeChat: vi.fn(),
      sendEdgeMessage: vi.fn(() => true),
      roomUpdates$: EMPTY,
      conversationUnreadState$: { subscribe: () => ({ unsubscribe() {} }), value: new Map() },
      realTimeMessages$: realTimeMessagesSubject.asObservable(),
      realTimeDeletions$: EMPTY,
      realTimeAcks$: realTimeAcksSubject.asObservable(),
      sendErrors$: EMPTY,
      connectionState$: of('connected'),
    };

    TestBed.configureTestingModule({
      imports: [Messages],
      providers: [
        { provide: MessageService, useValue: mockMessageService },
        { provide: ActivatedRoute, useValue: { queryParams: EMPTY } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AuthStore, useValue: { user: () => ({ id: 'user-1' }) } },
        { provide: OrderService, useValue: {} },
        { provide: I18nService, useValue: { t: (k: string) => k, lang: () => 'zh-TW' } },
        { provide: RegionService, useValue: { currency: () => ({ code: 'TWD', decimal_places: 0 }), region: () => 'tw', currentRegionObj: () => ({ search_engines: ['googlebooks'] }), regions: () => [{ code: 'tw', currency: { code: 'TWD', decimal_places: 0 } }] } },
        { provide: HttpClient, useValue: { get: vi.fn(), post: vi.fn() } },
      ],
    });

    fixture = TestBed.createComponent(Messages);
    component = fixture.componentInstance;
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
  });

  it('inserts out-of-order WebSocket messages into correct chronological order', () => {
    const chat = { id: 'conv-1' };
    component.selectChat(chat);
    component.userId = 'user-1';

    // Message 3 arrives first (timestamp 3000)
    realTimeMessagesSubject.next({
      id: 'msg-3',
      content: 'Third message',
      user_id: 'user-2',
      timestamp: 3000
    });

    // Message 1 arrives second (timestamp 1000)
    realTimeMessagesSubject.next({
      id: 'msg-1',
      content: 'First message',
      user_id: 'user-2',
      timestamp: 1000
    });

    // Message 2 arrives third (timestamp 2000)
    realTimeMessagesSubject.next({
      id: 'msg-2',
      content: 'Second message',
      user_id: 'user-2',
      timestamp: 2000
    });

    expect(component.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(component.messages.map(m => m.body)).toEqual(['First message', 'Second message', 'Third message']);
  });

  it('reconciles optimistic temp ID with server ack while maintaining order', () => {
    const chat = { id: 'conv-1' };
    component.selectChat(chat);
    component.userId = 'user-1';
    component.connectionState = 'connected';

    // Send an optimistic message
    component.newMessage = 'Optimistic hello';
    component.sendMessage();

    expect(component.messages.length).toBe(1);
    const tempId = component.messages[0].id;
    expect(tempId.startsWith('temp_')).toBe(true);

    // Server acks with real ID and timestamp
    realTimeAcksSubject.next({
      id: 'server-id-123',
      timestamp: 5000
    });

    expect(component.messages.length).toBe(1);
    expect(component.messages[0].id).toBe('server-id-123');
    expect(component.messages[0].body).toBe('Optimistic hello');
  });
});
