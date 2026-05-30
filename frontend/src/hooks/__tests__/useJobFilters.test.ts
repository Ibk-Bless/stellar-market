import {
  parseFiltersFromParams,
  filtersToParams,
  type JobFilters,
} from "@/hooks/useJobFilters";

describe("job filter URL sync (#544)", () => {
  describe("parseFiltersFromParams", () => {
    it("returns defaults for empty params", () => {
      expect(parseFiltersFromParams(new URLSearchParams())).toEqual({
        search: "",
        category: "All",
        skills: [],
        status: [],
        minBudget: "",
        maxBudget: "",
        postedDate: "all",
        sort: "newest",
        page: 1,
      });
    });

    it("parses every filter from query params", () => {
      const f = parseFiltersFromParams(
        new URLSearchParams(
          "q=design&category=Web&skills=react,ts&status=open,review&min=100&max=500&posted=last7d&sort=budget_desc&page=3",
        ),
      );
      expect(f).toEqual({
        search: "design",
        category: "Web",
        skills: ["react", "ts"],
        status: ["open", "review"],
        minBudget: "100",
        maxBudget: "500",
        postedDate: "last7d",
        sort: "budget_desc",
        page: 3,
      });
    });

    it("falls back to page 1 for a non-numeric page", () => {
      expect(parseFiltersFromParams(new URLSearchParams("page=abc")).page).toBe(1);
    });
  });

  describe("filtersToParams", () => {
    const defaults: JobFilters = {
      search: "",
      category: "All",
      skills: [],
      status: [],
      minBudget: "",
      maxBudget: "",
      postedDate: "all",
      sort: "newest",
      page: 1,
    };

    it("omits default values", () => {
      expect(filtersToParams(defaults).toString()).toBe("");
    });

    it("serializes active filters", () => {
      const params = filtersToParams({
        ...defaults,
        search: "design",
        category: "Web",
        skills: ["react", "ts"],
        status: ["open"],
        minBudget: "100",
        maxBudget: "500",
        sort: "budget_desc",
        page: 2,
      });
      expect(params.get("q")).toBe("design");
      expect(params.get("category")).toBe("Web");
      expect(params.get("skills")).toBe("react,ts");
      expect(params.get("status")).toBe("open");
      expect(params.get("min")).toBe("100");
      expect(params.get("max")).toBe("500");
      expect(params.get("sort")).toBe("budget_desc");
      expect(params.get("page")).toBe("2");
    });
  });

  it("round-trips parse(serialize(filters))", () => {
    const filters: JobFilters = {
      search: "audit",
      category: "Smart Contracts",
      skills: ["rust", "soroban"],
      status: ["open"],
      minBudget: "50",
      maxBudget: "",
      postedDate: "last24h",
      sort: "ending_soon",
      page: 4,
    };
    expect(parseFiltersFromParams(filtersToParams(filters))).toEqual(filters);
  });
});
