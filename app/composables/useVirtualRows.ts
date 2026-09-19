/**
 * Fixed-height windowing.
 *
 * Hand-rolled rather than pulled from a virtualiser library, and the reason is
 * that it can be: log rows are a fixed 32px by design, so the window is
 * arithmetic rather than measurement. That removes a dependency, the config
 * surface that comes with it, and the class of bugs where a virtualiser
 * measures wrong during a layout shift.
 *
 * The only measurement needed is the viewport height, and a ResizeObserver
 * keeps it current.
 */

export interface VirtualRowsOptions {
  /** Total number of rows available. */
  count: () => number
  rowHeight: number
  /** Extra rows rendered either side, so fast scrolling does not show gaps. */
  overscan?: number
  /**
   * Height of any fixed content rendered above the rows inside the same scroll
   * container — a column header, for example. The window maths has to skip it
   * or the first row index drifts as soon as it has scrolled past.
   */
  leadingOffset?: () => number
}

const DEFAULT_OVERSCAN = 10

export function useVirtualRows(options: VirtualRowsOptions) {
  const overscan = options.overscan ?? DEFAULT_OVERSCAN

  const scroller = ref<HTMLElement | null>(null)
  const scrollTop = ref(0)
  const viewportHeight = ref(0)

  /**
   * Row height comes from the stylesheet rather than only from the caller, so
   * the CSS token and the virtualiser cannot disagree — a 1px drift would
   * accumulate into visible gaps.
   */
  const rowHeight = ref(options.rowHeight)

  const totalHeight = computed(() => options.count() * rowHeight.value)

  /** Scroll offset of the first row, once the fixed header has scrolled past. */
  const rowsTop = computed(() =>
    Math.max(0, scrollTop.value - (options.leadingOffset?.() ?? 0)),
  )

  const startIndex = computed(() =>
    Math.max(0, Math.floor(rowsTop.value / rowHeight.value) - overscan),
  )

  const endIndex = computed(() =>
    Math.min(
      options.count(),
      Math.ceil((rowsTop.value + viewportHeight.value) / rowHeight.value) +
        overscan,
    ),
  )

  const offsetY = computed(() => startIndex.value * rowHeight.value)

  function onScroll() {
    const element = scroller.value
    if (element) scrollTop.value = element.scrollTop
  }

  function isAtBottom(slack = rowHeight.value * 2): boolean {
    const element = scroller.value
    if (!element) return true
    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <= slack
    )
  }

  function scrollToBottom() {
    const element = scroller.value
    if (!element) return
    element.scrollTop = element.scrollHeight
    scrollTop.value = element.scrollTop
  }

  function scrollToIndex(index: number) {
    const element = scroller.value
    if (!element) return
    const target = Math.max(0, index) * rowHeight.value
    element.scrollTop = target
    scrollTop.value = element.scrollTop
  }

  let observer: ResizeObserver | null = null

  onMounted(() => {
    const element = scroller.value
    if (!element) return

    const fromCss = Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--row-height'),
    )
    if (Number.isFinite(fromCss) && fromCss > 0) rowHeight.value = fromCss

    viewportHeight.value = element.clientHeight

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        viewportHeight.value = element.clientHeight
      })
      observer.observe(element)
    }
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return {
    scroller,
    scrollTop,
    viewportHeight,
    totalHeight,
    startIndex,
    endIndex,
    offsetY,
    onScroll,
    isAtBottom,
    scrollToBottom,
    scrollToIndex,
  }
}
