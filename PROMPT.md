# Campfire UX Improvement Loop

You are iteratively improving the Campfire AI companion app's UX and product quality. Each iteration, pick the highest-priority unfixed issue from the list below, implement the fix, verify it compiles, and commit with a descriptive message.

## How to Work

1. **Check git log** to see what has already been fixed in prior iterations
2. **Pick the next unfixed issue** from the prioritized list below (top = highest priority)
3. **Read the relevant files** before making changes
4. **Implement the fix** -- keep changes minimal and focused on the single issue
5. **Run `pnpm typecheck`** (or the relevant package typecheck) to verify no TypeScript errors
6. **Commit** with message format: `fix(ux): <short description> [RALPH-<issue number>]`
7. **Move to the next issue**

If an issue requires backend changes that aren't possible (missing API endpoints, etc.), skip it and note why in the commit message. Prefer issues that are purely frontend fixes.

## Rules

- One issue per iteration. Do not batch multiple fixes.
- Do not refactor surrounding code. Only change what the issue requires.
- Do not add new dependencies unless absolutely necessary.
- Preserve existing visual design and dark theme. Do not change colors/fonts unless the issue specifically requires it.
- Test your changes compile. If typecheck fails, fix it before committing.
- The app uses: Next.js 16 (App Router), React 19, Tailwind CSS, Radix UI, Framer Motion, shadcn/ui components.
- Packages: `packages/web` (Next.js frontend), `packages/mobile` (React Native/Expo), `packages/gateway` (Fastify backend), `packages/orchestrator`, `packages/workers`, `packages/shared`.

---

## Priority 1: Critical / Launch Blockers

### RALPH-001: Chat input is single-line, not textarea
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-input.tsx`
Replace `<Input>` with an auto-expanding `<textarea>`. Grow from 1 line to max 5 lines, then scroll internally. Send on Enter (without Shift), newline on Shift+Enter. Add subtle hint text "Enter to send, Shift+Enter for new line" that fades after first message.

### RALPH-002: Chat messages container has no live region
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-messages.tsx` (line 61)
Add `role="log"` and `aria-live="polite"` and `aria-label="Chat messages"` to the messages container div.

### RALPH-003: No skip navigation link in any layout
**Files:** `packages/web/src/app/(auth)/layout.tsx`, `packages/web/src/app/chat/[sessionId]/layout.tsx`, `packages/web/src/app/dashboard/layout.tsx`
Add a skip link as the first focusable element: `<a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:rounded-md focus:ring-2 focus:ring-ring">Skip to main content</a>`. Add `id="main-content"` to each layout's `<main>` element.

### RALPH-004: Games modal and gift purchase modal lack focus trap
**Files:** `packages/web/src/components/games/games-modal.tsx`, `packages/web/src/components/gifts/gift-purchase-modal.tsx`
Replace custom `motion.div` overlay pattern with Radix `Dialog` component (already in the project) which provides focus trap, Escape handling, and focus restoration automatically.

### RALPH-005: Mobile hamburger menu has no keyboard accessibility
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-header.tsx` (lines 125-233)
Add `role="menu"` to dropdown container, `role="menuitem"` to each button, `aria-expanded={showMobileMenu}` and `aria-haspopup="menu"` to the hamburger button, `aria-label="Menu"`. Add onKeyDown for Escape (close) and Arrow Up/Down (navigate items).

### RALPH-006: Form validation errors not linked to inputs
**Files:** `packages/web/src/app/(auth)/login/page.tsx`, `packages/web/src/app/(auth)/signup/page.tsx`, `packages/web/src/app/(auth)/forgot-password/page.tsx`
Add `aria-invalid={!!error}` and `aria-describedby={error ? "fieldname-error" : undefined}` to each input. Add `id="fieldname-error"` and `role="alert"` to each error `<p>`.

### RALPH-007: Forgot password is not implemented (fakes success)
**File:** `packages/web/src/app/(auth)/forgot-password/page.tsx` (lines 45-48)
Replace the fake `setTimeout` with an actual API call to the gateway. If the backend endpoint doesn't exist yet, show an honest message: "Password reset is coming soon. Please contact support." instead of faking success.

### RALPH-008: 2FA verification is not implemented (fakes success)
**File:** `packages/web/src/app/(auth)/two-factor/page.tsx` (lines 75-78, 102-103)
Same approach as RALPH-007. Replace fake setTimeout with real API or honest "coming soon" message. Remove hardcoded `****1234` phone number.

### RALPH-009: Hover-only interactions on companion cards fail on touch
**File:** `packages/web/src/app/dashboard/page.tsx` (lines 261-312)
Add `onClick` handler to cards that navigates to most relevant action (resume if session exists, new chat otherwise). On mobile, always show companion name. Use `@media (hover: hover)` or touch detection to differentiate behavior.

### RALPH-010: Account deletion not accessible from account page
**File:** `packages/web/src/app/account/page.tsx`
Import `DeleteAccountButton` from `packages/web/src/components/privacy/account-deletion.tsx`. Render it in a "Danger Zone" section after the sign-out button (around line 703).

### RALPH-011: Dynamic Tailwind classes won't render in production
**File:** `packages/web/src/components/onboarding/steps/step-5-traits.tsx` (lines 161, 170)
Replace dynamic `text-${slider.color}` with a lookup map of static class strings. All color variants must be statically present for Tailwind's purge to include them.

### RALPH-012: Support only accessible from within chat
**Files:** Add support entry point to `packages/web/src/app/dashboard/layout.tsx` or a shared app shell
Add a floating "?" help button (bottom-right corner) or "Help & Support" link in the header nav that opens `SupportModal` from any authenticated page, not just chat.

### RALPH-013: Legal pages reference "Ignite" instead of "Campfire"
**Files:** `packages/web/src/app/privacy/page.tsx`, `packages/web/src/app/terms/page.tsx`
Replace hardcoded "Ignite" brand references with dynamic brand config from `fetchBrandForRequest()`. Update "ignite.cam" domain references, "Back to Ignite" links, and email addresses.

### RALPH-014: Mobile app - no error/offline state for WebView
**File:** `packages/mobile/src/components/WebViewContainer.tsx` (lines 239-272)
Add `onError`, `onHttpError`, and `renderError` props to the WebView. Create a native error screen with retry button. Consider adding `@react-native-community/netinfo` for proactive offline detection.

### RALPH-015: Mobile app - splash hides before WebView content ready
**File:** `packages/mobile/App.tsx` (lines 10-17)
Move `SplashScreen.hideAsync()` to the WebView's `onLoadEnd` handler instead of calling it on mount. Keep splash visible until web content is ready.

### RALPH-016: Mobile app - no keyboard avoidance for chat input
**File:** `packages/mobile/src/components/WebViewContainer.tsx`
Wrap WebView in `KeyboardAvoidingView` with `behavior="padding"` on iOS. Add `softwareKeyboardLayoutMode: 'resize'` in `app.config.ts` for Android.

### RALPH-017: Mobile app - XSS via unsanitized deep link path injection
**Files:** `packages/mobile/src/hooks/useDeepLinking.ts` (lines 85-88), `packages/mobile/src/components/WebViewContainer.tsx` (lines 47-48, 228-229), `packages/mobile/src/utils/messageHandler.ts` (lines 119-121)
Use `JSON.stringify()` for all values interpolated into `injectJavaScript` template literals to prevent script injection via crafted deep links.

---

## Priority 2: High / Should Fix Before Launch

### RALPH-018: No prefers-reduced-motion support anywhere
**File:** `packages/web/src/app/layout.tsx` or root providers
Add `<MotionConfig reducedMotion="user">` wrapper from Framer Motion around the app. For GSAP animations in onboarding, check `window.matchMedia('(prefers-reduced-motion: reduce)')`.

### RALPH-019: All icon-only buttons missing aria-labels
**Files (batch fix):**
- `packages/web/src/components/voice-call/call-button.tsx` -> `aria-label="Start voice call"`
- `packages/web/src/components/voice-call/call-sidebar.tsx` -> mute: `aria-label={isMuted ? 'Unmute' : 'Mute'}`, end: `aria-label="End call"`
- `packages/web/src/app/chat/[sessionId]/components/chat-input.tsx` -> send: `aria-label="Send message"`, switch: `aria-label="Next companion"`
- `packages/web/src/app/(auth)/login/page.tsx` and `signup/page.tsx` -> password toggle: `aria-label={show ? 'Hide password' : 'Show password'}`
- `packages/web/src/components/gifts/gifts-panel.tsx` -> close buttons: `aria-label="Close"`
- `packages/web/src/components/games/games-modal.tsx` -> close: `aria-label="Close"`
- `packages/web/src/components/gifts/gift-purchase-modal.tsx` -> close: `aria-label="Close"`
- `packages/web/src/components/ui/toast.tsx` -> close: `aria-label="Close notification"`

### RALPH-020: Empty chat state is generic, not companion-aware
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-messages.tsx` (lines 97-101)
Use companion name: "Say hi to [Name]!" Add 2-3 tappable conversation starter chips that auto-fill the input on click.

### RALPH-021: Dashboard loading state is blank screen
**File:** `packages/web/src/app/dashboard/page.tsx` (lines 157-159)
Replace `return null` with a skeleton loading state showing placeholder companion grid cards.

### RALPH-022: ContinueConversation component exists but isn't rendered
**File:** `packages/web/src/app/dashboard/page.tsx`
Import `ContinueConversation` from `packages/web/src/components/dashboard/continue-conversation.tsx`. Render above the companion grid for authenticated users with recent sessions.

### RALPH-023: Voice call has no mobile experience
**File:** Create mobile call overlay component
The `CallSidebar` is `hidden lg:flex`. Create a `MobileCallOverlay` that appears as a floating card/bottom sheet on mobile when `isCallActive` is true, with voice orb, mute, and end call buttons.

### RALPH-024: Gifts panel overflows on mobile
**File:** `packages/web/src/components/gifts/gifts-panel.tsx` (line 350)
Change `w-[400px]` to `w-full lg:w-[400px]`. Add `left-0 right-0 bottom-0 lg:left-auto lg:right-4 lg:bottom-4` for mobile full-width bottom sheet pattern.

### RALPH-025: Voice call state changes not announced to screen readers
**File:** `packages/web/src/components/voice-call/call-sidebar.tsx` (lines 88-91)
Add `aria-live="polite"` to the status text element.

### RALPH-026: Tic-tac-toe board cells have no accessible labels
**File:** `packages/web/src/components/games/tic-tac-toe-board.tsx` (lines 39-77)
Add `aria-label` to each cell: `aria-label={`Row ${row+1} Column ${col+1}, ${cell || 'empty'}`}`. Add `role="grid"` to container.

### RALPH-027: Game status not announced to screen readers
**File:** `packages/web/src/components/games/game-board-container.tsx` (lines 93-98)
Add `aria-live="polite"` and `role="status"` to the game status message container.

### RALPH-028: Signup has too many friction fields
**File:** `packages/web/src/app/(auth)/signup/page.tsx`
Remove the Confirm Password field (show/hide toggle makes it redundant). Consider making Name optional or deferring to onboarding.

### RALPH-029: No "Back" button in onboarding steps
**Files:** `packages/web/src/components/onboarding/steps/step-3-personality.tsx`, `step-4-voice.tsx`, `step-5-traits.tsx`, `step-6-tenets.tsx`
Add a "Back" button alongside "Next" in every step's footer.

### RALPH-030: Voice list has no gender filtering
**File:** `packages/web/src/components/onboarding/steps/step-4-voice.tsx`
Add gender filter tabs (All / Feminine / Masculine). Pre-select based on companion pronouns from earlier step.

### RALPH-031: Account deletion modal uses hardcoded mock data
**File:** `packages/web/src/components/privacy/account-deletion.tsx` (lines 60-65)
Replace hardcoded counts (127 conversations, 384 memories, etc.) with actual API fetch, or show "all your data" without specific fake counts.

### RALPH-032: Forgot password page missing dark theme styling
**File:** `packages/web/src/app/(auth)/forgot-password/page.tsx`
Apply same card classes as login/signup: `bg-white/[0.03] backdrop-blur-xl border-white/10`. Update text colors to `text-white` variants.

### RALPH-033: "or" divider background is transparent
**Files:** `packages/web/src/app/(auth)/login/page.tsx` (lines 130-139), `signup/page.tsx` (lines 205-214)
Change the "or" span from `bg-transparent` to match the card/page background color so the line appears cleanly interrupted.

### RALPH-034: Brand name inconsistency (Campfire vs Ignite)
**Files:** Multiple across `packages/web/src/`
Audit all user-facing strings. Consolidate on the correct brand name. Use centralized brand config where possible.

---

## Priority 3: Medium / Post-Launch Polish

### RALPH-035: Backstory modal "Skip" closes modal instead of skipping animation
**File:** `packages/web/src/components/companion/backstory-modal.tsx` (lines 69-73)
Change `handleSkip` to set `displayedText` to full `backstory` and stop animation. Rename button to "Show All".

### RALPH-036: Search dropdown closes too aggressively via setTimeout
**File:** `packages/web/src/components/chat/session-search.tsx` (lines 119-124)
Use `onMouseDown` on results (fires before `onBlur`) to prevent premature closing. Or use `relatedTarget` check in `onBlur`.

### RALPH-037: Mobile menu doesn't close on outside click
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-header.tsx` (lines 160-233)
Add invisible backdrop overlay that closes menu on click.

### RALPH-038: Like button allows unlimited spam
**File:** `packages/web/src/components/likes/like-button.tsx` (lines 26-38)
Add 500ms cooldown between clicks. Consider a toggle (like/unlike) instead of infinite increment.

### RALPH-039: Companion avatar switcher arrows both do the same thing
**File:** `packages/web/src/components/companion/companion-avatar-switcher.tsx` (lines 45-72)
Replace two arrows with a single shuffle/refresh icon with tooltip "Generate new look".

### RALPH-040: No footer or legal links in app shell
**Files:** Create footer component, add to `packages/web/src/app/dashboard/layout.tsx` and `account/layout.tsx`
Minimal footer with: Privacy Policy, Terms of Service, Support link, year + brand name.

### RALPH-041: Companion grid too dense on large screens
**File:** `packages/web/src/app/dashboard/page.tsx` (line 227)
Cap at 8 columns on 2xl: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8`. Increase action button sizes to `p-2` with `h-4 w-4` icons.

### RALPH-042: Token system lacks clarity on what tokens buy
**File:** `packages/web/src/app/account/tokens/page.tsx`
Add a "What You Can Do" section showing example costs (e.g., "Send a rose: 5 tokens").

### RALPH-043: Account page tabs not URL-addressable
**File:** `packages/web/src/app/account/page.tsx` (line 51)
Use `useSearchParams()` to read/write active tab to URL. Support `/account?tab=tokens` deep linking.

### RALPH-044: Cookie consent X dismisses without saving preference
**File:** `packages/web/src/components/privacy/cookie-consent.tsx` (lines 128-131)
Either remove X button (require explicit choice) or treat dismiss as "reject all" and save that preference.

### RALPH-045: No "returnTo" flow from login page
**File:** `packages/web/src/app/(auth)/login/page.tsx`
Add `returnTo` extraction and forwarding, mirroring the signup implementation.

### RALPH-046: Public companion page has no demo/preview interaction
**File:** `packages/web/src/components/seo/companion-profile.tsx`
Pass companion slug as `returnTo` param: `/signup?returnTo=/c/${slug}`. After signup, redirect back.

### RALPH-047: Tenets step is overwhelming for first-time users
**File:** `packages/web/src/components/onboarding/steps/step-6-tenets.tsx`
Add "Use defaults" / "Skip" button. Pre-select 3-4 presets based on chosen archetype. Move custom rule builder to post-onboarding settings.

### RALPH-048: Typing indicator not announced to screen readers
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-messages.tsx` (lines 172-200)
Add `role="status"` and `aria-label="Companion is typing"` to the typing indicator container.

### RALPH-049: Canvas audio visualizers have no text alternatives
**Files:** `packages/web/src/components/voice-call/call-visualizer.tsx`, `voice-orb.tsx`
Add `role="img"` and `aria-label` describing the visualization state.

### RALPH-050: Onboarding progress bar has no step count
**File:** `packages/web/src/app/onboard/page.tsx` (lines 111-158)
Add "Step X of Y" label. Increase label text from `text-[10px]` to `text-xs`.

### RALPH-051: Duplicate formatRelativeTime implementations
**Files:** `packages/web/src/app/chat/page.tsx`, `packages/web/src/components/chat/session-search.tsx`
Extract shared `formatRelativeTime` to `packages/web/src/lib/utils/date.ts`.

### RALPH-052: Media gallery polls every 10s indefinitely
**File:** `packages/web/src/app/account/media/page.tsx` (lines 70-72)
Only poll when items are in pending/generating/encoding status. Stop when all items are ready/failed. Pause when tab is not visible.

### RALPH-053: Logout duplicated with inconsistent wording
**Files:** `packages/web/src/components/layout/dashboard-header-nav.tsx`, `packages/web/src/app/account/page.tsx`
Standardize on "Sign Out" everywhere. Remove duplicate from account page or keep only in header.

### RALPH-054: Streaming message has no cursor animation
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-messages.tsx` (lines 163-169)
Append blinking cursor element to streaming content (similar pattern to backstory-modal.tsx cursor).

### RALPH-055: Message bubbles too wide on large screens
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-messages.tsx` (line 140)
Add `lg:max-w-xl` cap in addition to `max-w-[80%]`.

### RALPH-056: No timestamps on chat messages
**File:** `packages/web/src/app/chat/[sessionId]/components/chat-messages.tsx`
Show timestamps on hover (desktop) or insert date separators between different time periods.

### RALPH-057: Auth layout logo link has no accessible text
**Files:** `packages/web/src/app/(auth)/layout.tsx`, `packages/web/src/app/chat/[sessionId]/components/chat-sidebar.tsx`
Add `aria-label="Campfire home"` to logo links.

### RALPH-058: Personality modal cancel doesn't revert tenet changes
**File:** `packages/web/src/components/companion/personality-modal.tsx`
Add inline "Changes saved" indicator when rules are added/deleted, since they persist immediately.

### RALPH-059: Mobile action bar has no scroll indicator
**File:** `packages/web/src/app/chat/[sessionId]/components/mobile-action-bar.tsx`
Add subtle fade gradient on right edge to hint at more scrollable content.

### RALPH-060: Tic-tac-toe board has fixed pixel dimensions
**File:** `packages/web/src/components/games/tic-tac-toe-board.tsx`
Use `max-w-[240px] w-full` on container and `aspect-square` on cells for responsive sizing.

### RALPH-061: Voice call connecting state has no cancel button
**File:** `packages/web/src/components/voice-call/call-sidebar.tsx`
Add "Cancel" button during connecting state. Add 15s timeout with "Try Again" error state.

### RALPH-062: Mobile app - bottom safe area not handled
**File:** `packages/mobile/src/components/WebViewContainer.tsx` (line 237)
Add `'bottom'` to SafeAreaView edges, or add `contentInsetAdjustmentBehavior="automatic"` to WebView.

### RALPH-063: Mobile app - no haptic feedback
**File:** `packages/mobile/src/services/AudioRecordingService.ts`
Install `expo-haptics`. Add haptic feedback on recording start/stop.

### RALPH-064: Mobile app - audio playback polling loop
**File:** `packages/mobile/src/services/AudioPlaybackService.ts` (lines 96-112)
Replace setTimeout polling with promise resolved from `onPlaybackStatusUpdate` callback.

### RALPH-065: Mobile app - push notification listener stale closure
**Files:** `packages/mobile/src/hooks/usePushNotifications.ts`, `packages/mobile/src/components/WebViewContainer.tsx`
Wrap notification tap handler in `useCallback`, or use ref-based pattern to avoid dependency churn.

### RALPH-066: Google signup bypasses terms acceptance
**File:** `packages/web/src/app/(auth)/signup/page.tsx`
Add note below Google button: "By signing up with Google, you agree to our Terms of Service and Privacy Policy."
