import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

/**
 * Fully custom, accessible dropdown that renders its menu in a portal so it is
 * never clipped by parent overflow/stacking contexts.
 *
 * Features: keyboard navigation, type-ahead, optional search box, smooth
 * open/close animation, and click-outside / scroll handling.
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = "Select...",
  allowEmpty = false,
  emptyLabel,
  searchable,
  disabled = false,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  ariaLabel,
  renderValue,
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [coords, setCoords] = useState(null);

  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const typeaheadRef = useRef({ text: "", timer: null });
  const listboxId = useId();

  const normalizedOptions = useMemo(
    () =>
      options.map((option) => ({
        value: option.value,
        label: option.label ?? String(option.value),
        disabled: Boolean(option.disabled),
      })),
    [options],
  );

  const isSearchable =
    searchable ?? normalizedOptions.length > 8;

  const filteredOptions = useMemo(() => {
    if (!isSearchable || !query.trim()) return normalizedOptions;
    const q = query.trim().toLowerCase();
    return normalizedOptions.filter((option) =>
      option.label.toLowerCase().includes(q),
    );
  }, [normalizedOptions, query, isSearchable]);

  const selectedOption = normalizedOptions.find(
    (option) => String(option.value) === String(value),
  );

  const displayLabel = selectedOption?.label ?? "";

  const updateCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      288,
      Math.max(160, (openUp ? spaceAbove : spaceBelow) - 16),
    );
    setCoords({
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? viewportH - rect.top + 6 : undefined,
      maxHeight,
      openUp,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    updateCoords();
    setOpen(true);
    const currentIndex = filteredOptions.findIndex(
      (option) => String(option.value) === String(value),
    );
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [disabled, updateCoords, filteredOptions, value]);

  // Mount animation flag
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf);
    }
    setMounted(false);
  }, [open]);

  // Move focus into the menu when opened so it receives keyboard events.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (isSearchable) searchRef.current?.focus();
      else menuRef.current?.focus();
    }, 20);
    return () => clearTimeout(t);
  }, [open, isSearchable]);

  // Reposition on scroll/resize while open
  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const handler = () => updateCoords();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, updateCoords]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (
        triggerRef.current?.contains(event.target) ||
        menuRef.current?.contains(event.target)
      )
        return;
      close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  // Keep active option scrolled into view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.children?.[activeIndex];
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, filteredOptions.length]);

  const commit = (option) => {
    if (!option || option.disabled) return;
    onChange?.(option.value);
    close();
    triggerRef.current?.focus();
  };

  const moveActive = (delta) => {
    setActiveIndex((prev) => {
      if (!filteredOptions.length) return -1;
      let next = prev;
      for (let i = 0; i < filteredOptions.length; i += 1) {
        next = (next + delta + filteredOptions.length) % filteredOptions.length;
        if (!filteredOptions[next].disabled) break;
      }
      return next;
    });
  };

  const handleTriggerKeyDown = (event) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
  };

  const handleMenuKeyDown = (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(filteredOptions.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        commit(filteredOptions[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        close();
        triggerRef.current?.focus();
        break;
      case "Tab":
        close();
        break;
      default:
        // Type-ahead when not using the search box
        if (!isSearchable && event.key.length === 1) {
          const store = typeaheadRef.current;
          store.text += event.key.toLowerCase();
          clearTimeout(store.timer);
          store.timer = setTimeout(() => {
            store.text = "";
          }, 600);
          const match = filteredOptions.findIndex((option) =>
            option.label.toLowerCase().startsWith(store.text),
          );
          if (match >= 0) setActiveIndex(match);
        }
        break;
    }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={
          buttonClassName ||
          `flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-[#1a1a1a] pl-3 pr-3 text-left text-base transition-all focus:outline-none focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:text-xs ${
            open ? "border-white/30" : "border-white/10 hover:border-white/20"
          }`
        }
      >
        <span
          className={`min-w-0 flex-1 truncate ${displayLabel ? "text-white" : "text-white/40"}`}
        >
          {renderValue
            ? renderValue(selectedOption)
            : displayLabel || placeholder}
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-white/40 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            id={listboxId}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
            style={{
              position: "fixed",
              left: coords.left,
              width: coords.width,
              top: coords.top,
              bottom: coords.bottom,
              maxHeight: coords.maxHeight,
              zIndex: 9999,
            }}
            className={`flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#15161a] shadow-2xl shadow-black/60 outline-none transition-all duration-150 ${
              mounted
                ? "opacity-100 translate-y-0 scale-100"
                : `opacity-0 scale-[0.98] ${coords.openUp ? "translate-y-1" : "-translate-y-1"}`
            } ${menuClassName}`}
          >
            {isSearchable && (
              <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                <Search size={14} className="shrink-0 text-white/30" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleMenuKeyDown}
                  placeholder="Search..."
                  className="w-full bg-transparent text-xs text-white placeholder-white/30 focus:outline-none"
                />
              </div>
            )}
            <div ref={listRef} className="overflow-y-auto overscroll-contain py-1">
              {allowEmpty && !query && (
                <Option
                  isActive={activeIndex === -1}
                  isSelected={!value}
                  onSelect={() => commit({ value: "" })}
                  onHover={() => setActiveIndex(-1)}
                  muted
                >
                  {emptyLabel || placeholder}
                </Option>
              )}
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-white/30">
                  No matches
                </div>
              ) : (
                filteredOptions.map((option, index) => (
                  <Option
                    key={String(option.value)}
                    isActive={index === activeIndex}
                    isSelected={String(option.value) === String(value)}
                    disabled={option.disabled}
                    onSelect={() => commit(option)}
                    onHover={() => setActiveIndex(index)}
                  >
                    {option.label}
                  </Option>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Option({
  children,
  isActive,
  isSelected,
  disabled,
  onSelect,
  onHover,
  muted,
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      disabled={disabled}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
        disabled
          ? "cursor-not-allowed text-white/25"
          : isActive
            ? "bg-white/10 text-white"
            : muted
              ? "text-white/45 hover:bg-white/5"
              : "text-white/75 hover:bg-white/5"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {isSelected && <Check size={14} className="shrink-0 text-white" />}
    </button>
  );
}
