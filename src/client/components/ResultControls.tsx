interface SortOption<T extends string> {
  value: T;
  label: string;
}

interface ResultControlsProps<T extends string = string> {
  total: number;
  pageStart: number;
  pageEnd: number;
  page: number;
  pageCount: number;
  perPage: number;
  /** Noun for the page-size select label, e.g. "Movies" / "Shows". */
  perPageLabel: string;
  perPageOptions?: number[];
  compact?: boolean;
  onPerPage: (value: number) => void;
  onPage: (value: number) => void;
  // Optional sort/order section — rendered only when sortOptions + onSort are provided (movies use
  // it; the TV view paginates without a sort and simply omits these).
  sort?: T;
  direction?: "asc" | "desc";
  sortOptions?: ReadonlyArray<SortOption<T>>;
  onSort?: (value: T) => void;
  onDirection?: (value: "asc" | "desc") => void;
}

const DEFAULT_PER_PAGE = [10, 25, 50, 100];

// Shared results pager (page size + "Showing X–Y of Z" + Previous/Next), used by both the movie and
// TV search views so they stay in lockstep. The sort/order selects are optional so the same control
// serves a sorted (movies) and an unsorted (TV) results list with identical styling.
export function ResultControls<T extends string = string>({
  total,
  pageStart,
  pageEnd,
  page,
  pageCount,
  perPage,
  perPageLabel,
  perPageOptions = DEFAULT_PER_PAGE,
  compact = false,
  onPerPage,
  onPage,
  sort,
  direction,
  sortOptions,
  onSort,
  onDirection
}: ResultControlsProps<T>) {
  if (!total) return null;
  const showSort = Boolean(sortOptions && onSort);

  return (
    <div className={compact ? "result-controls compact" : "result-controls"}>
      <span>
        Showing {pageStart}-{pageEnd} of {total}
      </span>
      <div className="result-control-fields">
        <label>
          {perPageLabel}
          <select value={perPage} onChange={(event) => onPerPage(Number(event.target.value))}>
            {perPageOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {showSort ? (
          <label>
            Sort
            <select value={sort} onChange={(event) => onSort?.(event.target.value as T)}>
              {sortOptions?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {showSort && onDirection ? (
          <label>
            Order
            <select value={direction} onChange={(event) => onDirection(event.target.value as "asc" | "desc")}>
              <option value="asc">Asc</option>
              <option value="desc">Desc</option>
            </select>
          </label>
        ) : null}
      </div>
      <div className="result-page-actions">
        <button className="secondary-button" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}>
          Previous
        </button>
        <span>
          Page {page + 1} of {pageCount}
        </span>
        <button className="secondary-button" onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}>
          Next
        </button>
      </div>
    </div>
  );
}
