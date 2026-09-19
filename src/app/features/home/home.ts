import { RegionLinkDirective } from '../../core/region-link.directive';
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UiButton } from '../../shared/ui/button.component';
import { UiRecentListings } from '../../shared/ui/recent-listings.component';
import { UiSkeleton } from '../../shared/ui/skeleton.component';
import { UiErrorState } from '../../shared/ui/error-state.component';
import { HomeHero, HeroCover } from './home-hero.component';
import { UiCategoryRail } from '../../shared/ui/category-rail.component';
import { ListingService } from '../../core/services/listing.service';
import { Subject } from 'rxjs';
import { takeUntil, distinctUntilChanged } from 'rxjs/operators';
import { ChangeDetectorRef, effect } from '@angular/core';
import { I18nService, TPipe } from '../../core/i18n.service';
import { CountCapPipe } from '../../shared/pipes/count-cap.pipe';
import { MetadataService, PublicAd } from '../../core/services/metadata.service';
import { SchoolStateService } from '../../core/services/school-state.service';
import { bookQueryParams } from '../../core/book-preview';
import { BookCoverPipe } from '../../shared/pipes/book-cover.pipe';
import { hasCoverFailed, markCoverFailed } from '../../shared/ui/book-cover.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RegionLinkDirective, CommonModule, RouterModule, HomeHero, UiButton, UiRecentListings, UiCategoryRail, UiSkeleton, UiErrorState, TPipe, CountCapPipe, BookCoverPipe],
  template: `
      <app-home-hero [covers]="heroCovers" (adClick)="onAdClick($event)"></app-home-hero>

      <!-- Categories: show skeleton during load, then the real content, never blank -->
      <div class="two-cols container" [class.hero-has-covers]="heroCovers.length > 0">
        <section class="col-main" aria-labelledby="recent-listings-heading">
          <ui-recent-listings [school]="currentSchool" [ads]="activeAds" (adClick)="onAdClick($event)"></ui-recent-listings>
        </section>

        <section
          class="col-side"
          [class.is-empty]="waitlistBandEmpty"
          [class.is-hero-covered]="waitlistFullyInHero"
          aria-labelledby="waitlist-heading"
        >
          <h2 class="section-heading" id="waitlist-heading">{{ 'home.waitlistTitle' | t }}</h2>
          <ui-skeleton *ngIf="metadataLoading && !metadataError" variant="row" [count]="4"></ui-skeleton>
          <!-- This branch used to contain only a spinner guarded by
               '!metadataError', so a failed load rendered the heading above
               and then nothing whatsoever. -->
          <ui-error-state
            *ngIf="metadataError"
            [message]="'home.waitlistError' | t"
            (retry)="loadMetadata()"
          ></ui-error-state>
          <ng-container *ngIf="!metadataLoading && !metadataError">
            <div class="waitlist-card" *ngIf="waitlist?.length">
              <a
                class="waitlist-row"
                *ngFor="let wait of waitlist; let i = index; trackBy: trackByTitle"
                [class.in-hero]="i < heroWaitlistCount"
                [regionLink]="['/book']"
                [queryParams]="waitlistParams(wait)"
              >
                <!-- alt="" on purpose: the thumbnail sits in the same link as the
                     visible title right beside it, so naming it would make a
                     screen reader read every waitlisted title twice. -->
                <!-- Through /api/cover like every other cover, at the hero's
                     zoom: the rows beside the hero are the same books, and the
                     same URL means one download the browser reuses. This used
                     to load the raw catalogue URL, so each of those books was
                     fetched twice — once directly from Google or Open Library,
                     unvalidated, and once through the proxy. Lazy, so the rows
                     hidden behind the hero (display: none) load nothing. -->
                <span class="wcover" aria-hidden="true">
                  <img *ngIf="wait.cover_url && !waitCoverFailed(wait)" [src]="wait.cover_url | bookCover: 3" alt="" loading="lazy" (error)="onWaitCoverError(wait)" />
                  <span class="wcover-mark" *ngIf="!wait.cover_url || waitCoverFailed(wait)">{{ (wait.title || '').slice(0, 1) }}</span>
                </span>
                <span class="wtitle">{{ wait.title }}</span>
                <span class="wcount">{{ 'home.waitingCount' | t:{n: wait.count | countCap} }}</span>
              </a>
              <ui-button variant="ghost" [link]="['/sell']" class="waitlist-cta">{{ 'home.sellCta' | t }}</ui-button>
            </div>
            <p class="empty-note" *ngIf="waitlist?.length === 0">{{ 'home.waitlistEmpty' | t }}</p>
          </ng-container>
        </section>
      </div>

      <section class="section container" aria-labelledby="categories-heading">
        <h2 class="section-heading" id="categories-heading">{{ 'home.categoriesTitle' | t }}</h2>
        <ui-skeleton *ngIf="categoriesLoading && !categoriesError" variant="card-row" [count]="4"></ui-skeleton>
        <ui-error-state
          *ngIf="categoriesError"
          [message]="'home.categoriesError' | t"
          (retry)="loadMetadata()"
        ></ui-error-state>
        <ng-container *ngIf="!categoriesLoading && !categoriesError">
          <ui-category-rail [categories]="categories"></ui-category-rail>
          <p class="empty-note" *ngIf="categories?.length === 0">{{ 'home.noCategories' | t }}</p>
        </ng-container>
      </section>

      <!-- The three "how it works" steps below are entirely buyer-side
           (search, message, meet up), so a seller reading this page never
           learns what listing costs them. This answers that, next to it. -->
      <section class="section container sell-band">
        <p>{{ 'home.sellHowPrompt' | t }}</p>
        <ui-button size="lg" [link]="['/sell']">{{ 'home.sellCtaHero' | t }}</ui-button>
      </section>

      <section class="section container how-it-works" aria-labelledby="how-heading">
        <h2 class="section-heading" id="how-heading">{{ 'home.howTitle' | t }}</h2>
        <div class="steps-grid">
          <div class="step-card">
            <div class="step-num" aria-hidden="true">1</div>
            <h3>{{ 'home.step1Title' | t }}</h3>
            <p>{{ 'home.step1Desc' | t }}</p>
          </div>
          <div class="step-card">
            <div class="step-num" aria-hidden="true">2</div>
            <h3>{{ 'home.step2Title' | t }}</h3>
            <p>{{ 'home.step2Desc' | t }}</p>
          </div>
          <div class="step-card">
            <div class="step-num" aria-hidden="true">3</div>
            <h3>{{ 'home.step3Title' | t }}</h3>
            <p>{{ 'home.step3Desc' | t }}</p>
          </div>
        </div>
      </section>
  `,
  styles: [`
    /* ---- sections ---------------------------------------------------- */
    /* column arithmetic comes from the global .container */
    .section { margin-bottom: var(--space-7); }

    
    .step-card h3 { font-size: var(--text-lg); }

    /* ---- listings + waitlist band -------------------------------------- */
    /* One column at every width. Putting the waitlist in a real second column
       is what the 'display: none' below used to be papering over: a ~100px
       card beside a 535px listing grid leaves 400px of dead column, and the
       ~300px it costs .col-main drops the listing grid under the 800px
       container query ui-recent-listings needs for its feature tile — from
       five tiles a row to three. The waitlist reads across instead (see the
       desktop rules further down), so it costs the grid nothing.
       align-items: start keeps each row content-height regardless. */
    .two-cols {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
      gap: var(--space-7);
      margin-bottom: var(--space-7);
    }
    .col-main, .col-side { min-width: 0; }

    /* The waitlist is the one artifact on this page that proves demand
       exists — "someone is already waiting for this book" is the single most
       persuasive thing a seller can see. Sitting unbounded in the narrow
       column it read as whatever was left over beside the grid, so it gets a
       surface of its own. */
    .col-side {
      background: var(--paper-warm);
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-xs);
      padding: var(--space-5);
    }
    .col-side .section-heading { margin-bottom: var(--space-4); }
    .waitlist-card { display: flex; flex-direction: column; }
    .waitlist-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) 0;
      border-bottom: 1px dashed var(--line);
      text-decoration: none;
      color: inherit;
    }
    .waitlist-row:last-of-type { border-bottom: none; }
    .waitlist-row:hover .wtitle { color: var(--accent); }
    .wcover {
      flex: 0 0 auto;
      width: 34px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-xs);
      background: var(--paper-warm);
      font-family: 'Noto Serif TC', serif;
      font-weight: 700;
      color: var(--ink-soft);
    }
    /* .cover-card img used to be merged into this selector. That coupled the
       waitlist thumbnail to the hero cover stack, and when the hero moved to
       its own component the rule stayed behind here — where view encapsulation
       scopes it to this component's elements, so the hero image lost its
       sizing entirely and rendered at its intrinsic 128x178. The hero owns its
       own copy now; this one covers only the waitlist thumbnail. */
    .wcover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    /* Noto Serif TC ships no italic face, so 'font-style: italic' here was
       being synthesised as a geometric slant across full-width Han glyphs —
       which is simply not how emphasis works in Chinese typography, and it
       looked like a rendering fault. Weight carries the emphasis instead. */
    .waitlist-row .wtitle {
      flex: 1;
      min-width: 0;
      font-family: 'Noto Serif TC', serif;
      font-weight: 700;
      font-size: var(--text-base);
      line-height: 1.4;
      transition: color var(--motion-base);
    }
    .waitlist-row .wcount {
      color: var(--flag);
      font-size: var(--text-xs);
      font-weight: 500;
      white-space: nowrap;
    }
    .waitlist-cta { margin-top: var(--space-4); display: block; }

    /* Desktop: the same panel, read across instead of down. The hero stack
       shows three of these covers but never says how many people are waiting
       for one unless you hover it, so hiding this panel above 768px left the
       "N 人在等" number — the one thing on the page that argues a seller has
       a buyer already — as mobile-only. Rows go into columns rather than a
       rail so the band stays two rows tall and .col-main keeps its width. */
    @media (min-width: 769px) {
      .col-side { padding: var(--space-5) var(--space-6); }
      /* Nothing to show but the heading and an empty note would be a
         page-wide empty box; the narrow mobile panel can carry that note. */
      .col-side.is-empty { display: none; }
      /* The hero cover stack is these same books — it is waitlist.slice(0, 3),
         same titles, same counts — and it is shown only from 769px up, which
         is exactly where this panel now also appears. Printing the top three
         twice on one page told a seller nothing the stack had not already
         said. The panel reads as "who else is waiting" instead.

         Hidden here rather than dropped from the list, because below 769 the
         stack is display: none and these are the only place those books
         appear at all. */
      .waitlist-row.in-hero { display: none; }
      /* Everything the panel had is in the stack above it, so there is nothing
         left for it to add. Distinct from .is-empty: nobody is waiting there,
         whereas here they are — the heading and its empty note would flatly
         contradict the counts printed on the covers. */
      .col-side.is-hero-covered { display: none; }
      .waitlist-card {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        column-gap: var(--space-6);
      }
      /* Every row keeps its rule, including the last: in a grid the rules read
         as the ledger lines the mobile list already uses, and dropping one
         arbitrary cell's line just looks like a missing border. */
      .waitlist-row:last-of-type { border-bottom: 1px dashed var(--line); }
      .waitlist-cta { grid-column: 1 / -1; justify-self: start; }
    }

    .sell-band {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      padding-block: var(--space-5);
      border-block: 1px solid var(--line);
    }
    .sell-band p {
      margin: 0;
      font-family: 'Noto Serif TC', serif;
      font-size: var(--text-xl);
      line-height: 1.4;
    }

    /* ---- how it works -------------------------------------------------- */
    .steps-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-5); }
    /* Left-aligned, not centred. Centred text under a centred ring numeral is
       the default shape of every landing-page template; the editorial voice
       this palette is reaching for comes from a hard left axis. */
    .step-card { border: none; border-left: 1px solid var(--line); padding: var(--space-6) var(--space-5); text-align: left; }
    .step-card:first-child { border-left: none; padding-left: 0; }
    /* The numeral is the ornament — oversized display serif in the secondary
       brand hue — instead of a 40px hairline circle. */
    .step-num {
      font-family: 'Noto Serif TC', serif;
      font-weight: 700;
      font-size: 48px;
      line-height: 1;
      color: var(--brand-warm);
      margin-bottom: var(--space-3);
    }
    .step-card h3 { margin: 0 0 var(--space-3); }
    .step-card p { margin: 0; color: var(--ink-soft); line-height: 1.7; font-size: var(--text-base); }


    /* ---- narrow screens ------------------------------------------------ */
    @media (max-width: 900px) {
      .two-cols { gap: var(--space-6); }
    }
    @media (max-width: 768px) {
      .steps-grid { grid-template-columns: 1fr; gap: 0; }
      .step-card { border-left: none; border-top: 1px solid var(--line); padding: var(--space-5) 0; }
      .step-card:first-child { border-top: none; padding-top: 0; }
      
    }
  `]
})
export class Home implements OnInit, OnDestroy {
  
  

  categories: any[] = [];
  waitlist: any[] = [];
  activeAds: PublicAd[] = [];
  currentSchool: string = '';
  heroCovers: HeroCover[] = [];

  /**
   * Ceiling for the "most wanted" list, mirroring the `[:7]` the metadata
   * endpoint already applies to its subscription aggregate. The server
   * capping it is not a reason for the page not to: this section is a demand
   * *signal* for sellers, not a directory, and a change on the server should
   * not be able to grow the home page into one.
   */
  private static readonly WAITLIST_MAX = 7;

  /**
   * The hero stack is capped lower, and for a physical rather than an
   * editorial reason: three cards fanned at scale(0.75) already span 408px of
   * the 420px stack, and HomeHero's rotation/offset tables define exactly
   * three positions — a fourth would wrap through `i % 3`, land on the first
   * card's coordinates, and be invisible with no error to show for it.
   */
  private static readonly HERO_COVERS_MAX = 3;

  categoriesLoading = false;
  metadataLoading = false;
  categoriesError = false;
  metadataError = false;

  /**
   * Whether the waitlist panel has nothing but its empty note to render.
   * Skeleton and error state both count as content — a band that vanishes
   * while loading and reappears with data is a layout jump, and a load that
   * fails silently on desktop is how the retry button went missing before.
   */
  get waitlistBandEmpty(): boolean {
    return !this.metadataLoading && !this.metadataError && this.waitlist?.length === 0;
  }

  /**
   * How many of the waitlist entries the hero stack is already showing. The
   * stack takes them off the front in order, so this doubles as the number of
   * rows the panel skips where the stack is visible — no matching by id or
   * title, which entries without a book_id would fall out of.
   */
  heroWaitlistCount = 0;

  /**
   * Whether the stack has the whole waitlist, leaving the panel with nothing
   * of its own. Only meaningful from 769px up, where the stack is shown; the
   * class it drives is read inside that media query alone.
   */
  get waitlistFullyInHero(): boolean {
    return this.waitlist?.length > 0 && this.heroWaitlistCount >= this.waitlist.length;
  }

  private metadataService = inject(MetadataService);
  private schoolStateService = inject(SchoolStateService);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();
  private i18n = inject(I18nService);

  constructor() {
    effect(() => {
      this.i18n.lang();
      this.loadMetadata();
    });
  }

  loadMetadata() {
    this.categoriesLoading = true;
    this.metadataLoading = true;
    this.metadataError = false;

    this.metadataService.getMetadata(this.currentSchool).subscribe({
      next: (data) => {
        if (data.categories) {
          this.categories = data.categories;
          
        }
        if (data.waitlist !== undefined) {
          this.waitlist = (data.waitlist || []).slice(0, Home.WAITLIST_MAX);
          this.updateHeroCovers();
        }
        this.categoriesLoading = false;
        this.metadataLoading = false;
        this.metadataError = false;
        this.cdr.markForCheck();
      },
      error: () => {
        // Keep any previously-loaded data visible so the page doesn't
        // go blank on a transient failure — only clear if first load fails
        if (!this.categories) {
          this.categoriesLoading = false;
        }
        if (this.waitlist.length === 0) {
          this.metadataLoading = false;
        }
        this.metadataError = true;
        console.error('Failed to load metadata — will retry on next interaction');
        this.cdr.markForCheck();
      }
    });
  }

  retry() {
    this.loadMetadata();
  }

  ngOnInit() {
    this.schoolStateService.selectedSchool$.pipe(
      takeUntil(this.destroy$),
      distinctUntilChanged()
    ).subscribe(school => {
      this.currentSchool = school || '';
      this.loadAds();
      this.loadMetadata();
      this.cdr.markForCheck();
    });
  }

  loadAds() {
    this.metadataService.getActiveAds('home_banner', this.currentSchool).subscribe({
      next: (resp: any) => {
        // BE returns paginated format { count, results } after adding pagination_class
        this.activeAds = resp?.results ?? (Array.isArray(resp) ? resp : []);
        this.updateHeroCovers();
        this.cdr.markForCheck();

        this.activeAds.forEach(ad => {
          const viewedKey = `ad_viewed_${ad.id}`;
          if (!sessionStorage.getItem(viewedKey)) {
            sessionStorage.setItem(viewedKey, '1');
            this.metadataService.recordAdView(ad.id)
              .pipe(takeUntil(this.destroy$))
              .subscribe({ error: () => {} });
          }
        });
      },
      error: () => {
        this.activeAds = [];
        this.updateHeroCovers();
        this.cdr.markForCheck();
      }
    });
  }

  /**
   * Tracking only. The banner is a real anchor with a real href now, so this
   * must not preventDefault or window.open: doing both is what stripped the
   * link of middle-click, "open in new tab" and keyboard access, and put a
   * popup-blocker-triggering window.open in the click path.
   */
  onAdClick(ad: PublicAd) {
    this.metadataService.recordAdClick(ad.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ error: () => {} });
  }

  private updateHeroCovers() {
    const heroAd = this.activeAds.find(ad => ad.show_in_hero);
    const maxWaitlist = heroAd ? Math.max(0, Home.HERO_COVERS_MAX - 1) : Home.HERO_COVERS_MAX;
    const waitlistCovers: HeroCover[] = this.waitlist.slice(0, maxWaitlist).map(w => ({
      id: w.book_id,
      title: w.title,
      coverUrl: w.cover_url,
      count: w.count
    }));

    this.heroWaitlistCount = waitlistCovers.length;

    if (heroAd) {
      const adCover: HeroCover = {
        id: heroAd.id,
        title: heroAd.headline || heroAd.title,
        coverUrl: heroAd.image_url,
        isAd: true,
        targetUrl: heroAd.target_url,
        adData: heroAd
      };
      this.heroCovers = [adCover, ...waitlistCovers];
    } else if (waitlistCovers.length > 0) {
      this.heroCovers = waitlistCovers;
    } else {
      this.heroCovers = [];
    }
    this.cdr.markForCheck();
  }

  /** No preview state: nothing primes the book cache from a waitlist row. */
  waitlistParams(wait: any): Record<string, any> {
    return bookQueryParams({ isbn: wait?.isbn, id: wait?.book_id });
  }

  trackById(idx: number, item: any): any { return item.id || idx; }
  trackByTitle(idx: number, wait: any): string { return wait.title; }

  /** Shared with ui-book-cover: a cover that failed anywhere is not asked for again. */
  waitCoverFailed(wait: any): boolean { return hasCoverFailed(wait.cover_url, 3); }
  onWaitCoverError(wait: any): void { markCoverFailed(wait.cover_url, 3); }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
