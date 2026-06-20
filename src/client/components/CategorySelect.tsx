import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface CategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  downloaderType: string;
  downloaderBaseUrl: string;
  downloaderApiKey: string;
  placeholder?: string;
}

// Category picker for SABnzbd / NZBGet. Fetches the downloader's configured categories once per
// downloader-config change (not per keystroke) and renders a dropdown. Falls back to a free-text
// field when the downloader is unset, the fetch fails, or no categories come back.
export function CategorySelect({
  value,
  onChange,
  downloaderType,
  downloaderBaseUrl,
  downloaderApiKey,
  placeholder = "movies"
}: CategorySelectProps) {
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    if (downloaderType === "none" || !downloaderBaseUrl) {
      setCategories([]);
      return;
    }
    api
      .downloaderCategories({ downloaderType, downloaderBaseUrl, downloaderApiKey })
      .then((response) => {
        if (active) setCategories(response.categories);
      })
      .catch(() => {
        if (active) setCategories([]);
      });
    return () => {
      active = false;
    };
  }, [downloaderType, downloaderBaseUrl, downloaderApiKey]);

  if (!categories.length) {
    return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />;
  }

  // Keep the current value selectable even if the downloader no longer lists it.
  const options = !value || categories.includes(value) ? categories : [value, ...categories];

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {value ? null : <option value="">Default</option>}
      {options.map((category) => (
        <option key={category} value={category}>
          {category}
        </option>
      ))}
    </select>
  );
}
