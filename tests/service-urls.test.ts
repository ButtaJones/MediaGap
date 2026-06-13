import { describe, expect, it } from "vitest";
import { serviceUrl } from "../src/server/integrations/downloader";
import { hydraApiUrl } from "../src/server/integrations/nzbhydra";

describe("service URLs", () => {
  it("preserves reverse proxy or app path prefixes", () => {
    expect(serviceUrl("http://host:8080/sabnzbd", "api").toString()).toBe("http://host:8080/sabnzbd/api");
    expect(serviceUrl("http://host:8080/sabnzbd/api", "api").toString()).toBe("http://host:8080/sabnzbd/api");
    expect(hydraApiUrl("http://host:5076/nzbhydra").toString()).toBe("http://host:5076/nzbhydra/api");
  });
});
