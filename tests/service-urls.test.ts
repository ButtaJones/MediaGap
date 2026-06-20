import { describe, expect, it } from "vitest";
import { serviceUrl } from "../src/server/integrations/downloader";
import { hydraApiUrl } from "../src/server/integrations/nzbhydra";
import { seerrApiUrl } from "../src/server/integrations/seerr";

describe("service URLs", () => {
  it("preserves reverse proxy or app path prefixes", () => {
    expect(serviceUrl("http://host:8080/sabnzbd", "api").toString()).toBe("http://host:8080/sabnzbd/api");
    expect(serviceUrl("http://host:8080/sabnzbd/api", "api").toString()).toBe("http://host:8080/sabnzbd/api");
    expect(hydraApiUrl("http://host:5076/nzbhydra").toString()).toBe("http://host:5076/nzbhydra/api");
  });

  it("builds Seerr API paths with and without a trailing slash or proxy prefix", () => {
    expect(seerrApiUrl("http://host:5055", "request").toString()).toBe("http://host:5055/api/v1/request");
    expect(seerrApiUrl("http://host:5055/", "status").toString()).toBe("http://host:5055/api/v1/status");
    expect(seerrApiUrl("http://host:5055/seerr", "movie/603").toString()).toBe("http://host:5055/seerr/api/v1/movie/603");
  });
});
