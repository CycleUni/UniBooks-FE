import { TestBed } from '@angular/core/testing';
import { MeetupModalComponent } from './meetup-modal.component';

describe('MeetupModalComponent', () => {
  let component: MeetupModalComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MeetupModalComponent] });
    component = TestBed.createComponent(MeetupModalComponent).componentInstance;
  });

  it('is empty until any of date, time or place is entered', () => {
    expect(component.isEmpty).toBe(true);

    component.location = '   ';
    expect(component.isEmpty).toBe(true);

    component.location = 'Library';
    expect(component.isEmpty).toBe(false);

    component.location = '';
    component.meetupTime = '15:00';
    expect(component.isEmpty).toBe(false);

    component.meetupTime = '';
    component.selectedDay = 12;
    expect(component.isEmpty).toBe(false);
  });

  it('skipping confirms with no time or place', () => {
    let emitted: unknown;
    component.onConfirmed.subscribe(v => (emitted = v));
    component.onConfirm();
    expect(emitted).toEqual({ time: '', location: '' });
  });
});
