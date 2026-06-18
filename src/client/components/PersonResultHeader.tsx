import { UserRound } from "lucide-react";
import type { PersonHeader } from "../../shared/types";

interface PersonResultHeaderProps {
  person: PersonHeader;
}

export function PersonResultHeader({ person }: PersonResultHeaderProps) {
  const flag = nationalityFlag(person.placeOfBirth);
  const life = personLifeLine(person.birthday, person.deathday);

  return (
    <header className="panel person-header">
      <div className="person-header-photo">
        {person.profilePath ? <img src={person.profilePath} alt="" /> : <UserRound size={34} />}
      </div>
      <div className="person-header-body">
        <h2 className="person-header-name">
          {person.name}
          {flag ? <span className="person-header-flag">{flag}</span> : null}
        </h2>
        {life ? <p className="person-header-life">{life}</p> : null}
        {person.knownFor ? (
          <p className="person-header-known">
            <span className="person-header-known-label">Known for</span> {person.knownFor}
          </p>
        ) : null}
      </div>
    </header>
  );
}

/** Lifespan for the deceased, age for the living, nothing when there's no birthday. */
export function personLifeLine(birthday: string | null, deathday: string | null): string | null {
  if (!birthday) return null;
  const birthYear = birthday.slice(0, 4);
  if (!/^\d{4}$/.test(birthYear)) return null;
  if (deathday) {
    const deathYear = deathday.slice(0, 4);
    return /^\d{4}$/.test(deathYear) ? `${birthYear}–${deathYear}` : null;
  }
  const age = computeAge(birthday);
  return age != null ? `Age ${age} (born ${birthYear})` : null;
}

export function computeAge(birthday: string): number | null {
  const born = new Date(birthday);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** Best-effort nationality flag from TMDb's free-text place_of_birth ("…, Country").
 *  Returns an emoji flag for common countries, or null to omit gracefully. */
const COUNTRY_FLAGS: Record<string, string> = {
  usa: "US", "united states": "US", "united states of america": "US", america: "US",
  uk: "GB", "united kingdom": "GB", england: "GB", scotland: "GB", wales: "GB",
  "northern ireland": "GB", "great britain": "GB", britain: "GB",
  canada: "CA", australia: "AU", "new zealand": "NZ", ireland: "IE",
  france: "FR", germany: "DE", "west germany": "DE", "east germany": "DE",
  italy: "IT", spain: "ES", portugal: "PT", netherlands: "NL", belgium: "BE",
  austria: "AT", switzerland: "CH", sweden: "SE", norway: "NO", denmark: "DK",
  finland: "FI", poland: "PL", russia: "RU", "soviet union": "RU", ussr: "RU",
  ukraine: "UA", greece: "GR", japan: "JP", china: "CN", "hong kong": "HK",
  "south korea": "KR", korea: "KR", india: "IN", mexico: "MX", brazil: "BR",
  argentina: "AR", "south africa": "ZA", egypt: "EG", israel: "IL", turkey: "TR",
  iran: "IR", iceland: "IS", hungary: "HU", "czech republic": "CZ", czechoslovakia: "CZ",
  romania: "RO", cuba: "CU", colombia: "CO", chile: "CL", philippines: "PH"
};

function nationalityFlag(placeOfBirth: string | null): string | null {
  if (!placeOfBirth) return null;
  const country = placeOfBirth.split(",").pop()?.trim().toLowerCase();
  if (!country) return null;
  const iso = COUNTRY_FLAGS[country];
  if (!iso) return null;
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
