import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MessagesInboxList } from './inbox-list.component';
import { I18nService } from '../../core/i18n.service';

describe('MessagesInboxList', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MessagesInboxList],
      providers: [{ provide: I18nService, useValue: { lang: () => 'en', t: (key: string) => key } }],
    });
  });

  it('shows the other party\'s school beside a name that may not be unique', () => {
    const fixture = TestBed.createComponent(MessagesInboxList);
    fixture.componentInstance.chats = [
      { id: 'c1', other_party: '周恭煥', other_party_school_name: 'North University', other_party_role: 'seller', listing_title: 'A' },
      { id: 'c2', other_party: '周恭煥', other_party_school_name: '', other_party_role: 'buyer', listing_title: 'B' },
    ];
    fixture.detectChanges();

    const partners = Array.from(fixture.nativeElement.querySelectorAll('.chat-partner')) as HTMLElement[];
    expect(partners[0].textContent).toContain('周恭煥 · North University');
    // No dangling separator when the school is unknown.
    expect(partners[1].textContent?.trim()).toBe('周恭煥');
  });
});
