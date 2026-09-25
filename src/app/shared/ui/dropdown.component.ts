import { Component, Input, forwardRef, ElementRef, HostListener, inject, ViewChild, ViewContainerRef, TemplateRef, EmbeddedViewRef, AfterViewInit, OnDestroy, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { I18nService, TPipe } from '../../core/i18n.service';

export interface DropdownOption {
  value: string;
  label: string;
}

@Component({
  selector: 'ui-dropdown',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe],
  template: `
    <div class="dropdown-wrapper" [class.compact]="compact">
      <label *ngIf="label">{{ label }}</label>
      <div class="ui-dropdown">
        <button
          #trigger
          type="button"
          class="dropdown-trigger"
          [class.icon-only]="iconOnly"
          [disabled]="disabled"
          [attr.aria-expanded]="open"
          [attr.aria-label]="triggerAriaLabel"
          aria-haspopup="listbox"
          (click)="toggle()"
        >
          <ng-content select="[dropdownTrigger]"></ng-content>
          <span *ngIf="!customTrigger" class="dropdown-trigger-label">{{ selectedLabel || placeholder }}</span>
          <svg class="dropdown-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <ng-template #panelTemplate>
          <div class="dropdown-panel" [class.align-right]="align === 'right' && !appendToBody" [class.append-to-body]="appendToBody" [ngStyle]="panelStyle" *ngIf="open">
            <input
              *ngIf="searchable"
              type="text"
              class="dropdown-search"
              [placeholder]="'common.search' | t"
              [(ngModel)]="searchQuery"
              (click)="$event.stopPropagation()"
            />
            <ul class="dropdown-list" role="listbox">
              <li
                *ngFor="let opt of filteredOptions"
                role="option"
                [attr.aria-selected]="opt.value === value"
                [class.active]="opt.value === value"
                (click)="selectOption(opt)"
              >
                <span>{{ opt.label }}</span>
                <svg *ngIf="opt.value === value" class="dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </li>
              <li *ngIf="filteredOptions.length === 0" class="dropdown-empty">{{ 'common.noMatches' | t }}</li>
            </ul>
          </div>
        </ng-template>

        <ng-container *ngIf="!appendToBody">
          <ng-container *ngTemplateOutlet="panelTemplate"></ng-container>
        </ng-container>
      </div>
    </div>
  `,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => UiDropdown),
      multi: true
    }
  ],
  styles: [`
    .dropdown-wrapper {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }
    .dropdown-wrapper.compact {
      margin-bottom: 0;
    }
    label {
      font-size: var(--text-base);
      font-weight: 500;
      color: var(--ink);
    }
    .ui-dropdown {
      position: relative;
    }
    .dropdown-trigger {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      /* A <button> sizes to max-content and will not shrink below it, so a long
         label escapes the wrapper's width and overlaps whatever sits next to it
         in the header. Capping it here lets the existing min-width:0 on the
         inner trigger do its job and the label's ellipsis finally engages. */
      max-width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-control);
      background-color: var(--paper);
      color: var(--ink);
      font-size: var(--text-base);
      font-family: inherit;
      cursor: pointer;
      text-align: left;
    }
    .dropdown-trigger:disabled {
      background-color: var(--paper-warm);
      cursor: not-allowed;
    }
    .dropdown-trigger[aria-expanded="true"] {
      border-color: var(--accent);
    }
    /* Icon-only trigger (e.g. the header language switcher): no field
       chrome, sized to its content instead of stretching full width. */
    .dropdown-trigger.icon-only {
      width: auto;
      padding: 4px;
      border: none;
      background: none;
      color: var(--muted);
    }
    @media (pointer: coarse) {
      .dropdown-trigger.icon-only {
        padding: 13px;
        margin: -9px;
        /* The negative margins widen the hit area past the wrapper by 18px;
           a plain 100% cap would take that back out of the content and
           squeeze a visible label (the header school name) to a sliver. */
        max-width: calc(100% + 18px);
      }
    }
    .dropdown-trigger.icon-only:hover,
    .dropdown-trigger.icon-only[aria-expanded="true"] {
      color: var(--ink);
    }
    .dropdown-trigger-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dropdown-caret {
      flex-shrink: 0;
      color: var(--muted);
    }
    .dropdown-panel {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      min-width: 180px;
      padding: 4px;
      background-color: var(--surface-raised);
      border: 1px solid var(--surface-raised-border);
      border-radius: var(--radius-control);
      box-shadow: var(--shadow-card-lg);
      z-index: 200;
    }
    .dropdown-panel.append-to-body {
      position: fixed;
      top: auto;
      left: auto;
      right: auto;
      min-width: 200px;
      z-index: 1000;
    }
    /* For icon-only triggers, the panel shouldn't stretch to the (narrow)
       trigger's width — anchor it to the right edge with its own min-width. */
    .dropdown-panel.align-right {
      left: auto;
      right: 0;
      width: max-content;
    }
    .dropdown-search {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      margin-bottom: 4px;
      border: 1px solid var(--line);
      border-radius: var(--radius-control);
      font-size: var(--text-base);
      font-family: inherit;
      color: var(--ink);
      background-color: var(--paper);
    }
    /* No outline reset. The global :focus-visible ring in styles.css is the
       focus indicator; a border-colour swap alone is ~1.9:1 on a 1px line. */
    .dropdown-search:focus-visible {
      border-color: var(--accent);
    }
    .dropdown-list {
      margin: 0;
      padding: 0;
      list-style: none;
      max-height: 240px;
      overflow-y: auto;
    }
    .dropdown-list li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px;
      font-size: var(--text-base);
      color: var(--ink);
      cursor: pointer;
      border-radius: var(--radius-control);
    }
    .dropdown-list li:hover {
      background-color: var(--paper-warm);
    }
    .dropdown-list li.active {
      color: var(--accent);
      font-weight: 700;
    }
    .dropdown-check {
      flex-shrink: 0;
      color: var(--accent);
    }
    .dropdown-empty {
      color: var(--muted);
      cursor: default;
    }
    .dropdown-empty:hover {
      background-color: transparent;
    }
  `]
})
export class UiDropdown implements ControlValueAccessor, AfterViewInit, OnDestroy {
  @Input() label: string = '';
  @Input() placeholder: string = '';
  @Input() options: DropdownOption[] = [];
  @Input() searchable: boolean = true;
  // Set when projecting custom trigger content (e.g. an icon) via
  // [dropdownTrigger] instead of showing the selected option's label.
  @Input() customTrigger: boolean = false;
  // Strips the field chrome (border/background) down to a bare icon button.
  // Independent of customTrigger: a custom-trigger dropdown can still want
  // the bordered field look (e.g. a compact select-style school picker).
  @Input() iconOnly: boolean = false;
  // Accessible name for the trigger button, needed when the projected
  // trigger content (e.g. an icon-only SVG) has no visible text.
  @Input() triggerAriaLabel: string | null = null;
  // Drops the form-field bottom margin, for inline header usage rather
  // than a stacked form field.
  @Input() compact: boolean = false;
  @Input() align: 'left' | 'right' = 'left';
  // When true, the dropdown panel is rendered in the document body
  // and positioned via getBoundingClientRect() to avoid clipping.
  @Input() appendToBody: boolean = false;

  /** Move the currently selected option to the top of the list so it is easy
      to find in a long list. Opt-in: short lists read better in a fixed order. */
  @Input() pinSelected: boolean = false;

  @ViewChild('trigger') triggerRef!: ElementRef<HTMLButtonElement>;
  @ViewChild('panelTemplate', { read: TemplateRef }) panelTemplateRef!: TemplateRef<any>;

  open = false;
  searchQuery = '';
  value: string = '';
  @Input() disabled: boolean = false;

  panelStyle: Record<string, string> = {};
  private bodyPanelRef: EmbeddedViewRef<any> | null = null;
  private resizeHandler = () => this.updatePanelPosition();

  private elementRef = inject(ElementRef);
  private i18n = inject(I18nService);
  private viewContainerRef = inject(ViewContainerRef);
  private platformId = inject(PLATFORM_ID);

  private isBrowser = isPlatformBrowser(this.platformId);

  onChange = (val: string) => {};
  onTouched = () => {};

  get selectedLabel(): string {
    return this.options.find(o => o.value === this.value)?.label || '';
  }

  get filteredOptions(): DropdownOption[] {
    const base = (!this.searchable || !this.searchQuery.trim())
      ? this.options
      : this.options.filter(o => o.label.toLowerCase().includes(this.searchQuery.trim().toLowerCase()));
    if (!this.pinSelected || !this.value) return base;
    const idx = base.findIndex(o => o.value === this.value);
    if (idx <= 0) return base;
    return [base[idx], ...base.slice(0, idx), ...base.slice(idx + 1)];
  }

  ngAfterViewInit() {
    // Panel is rendered via ngTemplateOutlet
  }

  ngOnDestroy() {
    this.close();
    this.destroyBodyPanel();
    if (this.isBrowser) {
      window.removeEventListener('resize', this.resizeHandler);
      window.removeEventListener('scroll', this.resizeHandler);
    }
  }

  toggle() {
    if (this.disabled) return;
    this.open = !this.open;
    if (this.open) {
      this.searchQuery = '';
      if (this.appendToBody && this.isBrowser) {
        this.createBodyPanel();
        this.updatePanelPosition();
        window.addEventListener('resize', this.resizeHandler);
        window.addEventListener('scroll', this.resizeHandler);
        this.observeTrigger();
      }
    } else {
      this.destroyBodyPanel();
      this.cleanupObservers();
      if (this.isBrowser) {
        window.removeEventListener('resize', this.resizeHandler);
        window.removeEventListener('scroll', this.resizeHandler);
      }
    }
  }

  close() {
    this.open = false;
    this.searchQuery = '';
    this.destroyBodyPanel();
    this.cleanupObservers();
    if (this.isBrowser) {
      window.removeEventListener('resize', this.resizeHandler);
      window.removeEventListener('scroll', this.resizeHandler);
    }
  }

  private triggerResizeObserver: ResizeObserver | null = null;

  private observeTrigger() {
    if (!this.isBrowser || !this.triggerRef) return;
    this.triggerResizeObserver = new ResizeObserver(() => {
      if (this.open) this.updatePanelPosition();
    });
    this.triggerResizeObserver.observe(this.triggerRef.nativeElement);
  }

  private cleanupObservers() {
    if (this.triggerResizeObserver) {
      this.triggerResizeObserver.disconnect();
      this.triggerResizeObserver = null;
    }
  }

  private createBodyPanel() {
    if (!this.isBrowser || this.bodyPanelRef || !this.panelTemplateRef) return;
    this.bodyPanelRef = this.viewContainerRef.createEmbeddedView(this.panelTemplateRef);
    const elements = this.bodyPanelRef.rootNodes.filter((node: any) => node.nodeType === Node.ELEMENT_NODE);
    elements.forEach((el: HTMLElement) => document.body.appendChild(el));
    this.bodyPanelRef.detectChanges();
  }

  private destroyBodyPanel() {
    if (!this.isBrowser) return;
    if (this.bodyPanelRef) {
      this.bodyPanelRef.destroy();
      this.bodyPanelRef = null;
    }
  }

  private updatePanelPosition() {
    if (!this.isBrowser || !this.appendToBody || !this.triggerRef) return;

    const triggerRect = this.triggerRef.nativeElement.getBoundingClientRect();
    const panelWidth = Math.max(triggerRect.width, 200);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Measure the panel's actual rendered height so it can flip to open
    // upward when there isn't enough room below the trigger (e.g. a filter
    // near the bottom of a short sidebar) instead of being clipped by the
    // viewport edge.
    const panelEl = this.bodyPanelRef?.rootNodes.find(
      (node: any) => node.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement | undefined;
    const panelHeight = panelEl?.getBoundingClientRect().height || 0;

    // Auto-align: prefer left, but flip to right if it would overflow
    let left = triggerRect.left;
    let alignRight = false;

    if (this.align === 'right') {
      alignRight = true;
      left = triggerRect.right - panelWidth;
    } else if (triggerRect.left + panelWidth > viewportWidth - 8) {
      // Check if right-aligned would fit
      if (triggerRect.right - panelWidth >= 8) {
        alignRight = true;
        left = triggerRect.right - panelWidth;
      } else {
        // Clamp to viewport
        left = Math.max(8, viewportWidth - panelWidth - 8);
      }
    }

    // Ensure left is within viewport
    if (left < 8) left = 8;
    if (left + panelWidth > viewportWidth - 8) {
      left = viewportWidth - panelWidth - 8;
    }

    // Prefer opening below the trigger; flip above it only when there's not
    // enough room below but there is above.
    let top = triggerRect.bottom + 4;
    if (panelHeight && top + panelHeight > viewportHeight - 8 && triggerRect.top - panelHeight - 4 >= 8) {
      top = triggerRect.top - panelHeight - 4;
    }

    this.panelStyle = {
      top: `${top}px`,
      left: `${left}px`,
      width: `${panelWidth}px`,
    };
    this.bodyPanelRef?.detectChanges();
  }

  selectOption(opt: DropdownOption) {
    this.value = opt.value;
    this.onChange(opt.value);
    this.onTouched();
    this.close();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.open) {
      const target = event.target as Node;
      const triggerClicked = this.triggerRef?.nativeElement.contains(target);
      const panelClicked = this.bodyPanelRef?.rootNodes.some((node: any) => node.contains(target));
      if (!triggerClicked && !panelClicked) {
        this.close();
      }
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    this.close();
  }

  writeValue(val: any): void {
    this.value = (val !== null && val !== undefined) ? String(val) : '';
  }
  registerOnChange(fn: any): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }
  setDisabledState?(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }
}
