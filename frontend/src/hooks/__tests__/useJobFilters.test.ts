import {
  parseFiltersFromParams,
  filtersToParams,
  type JobFilters,
} from "@/hooks/useJobFilters";

describe("job filter URL sync (#815)", () => {
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
      category: "Smart Contract",
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

  describe("category slug encoding (#815)", () => {
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

    it("selecting Smart Contract updates URL to ?category=smart-contract", () => {
      const params = filtersToParams({ ...defaults, category: "Smart Contract" });
      expect(params.get("category")).toBe("smart-contract");
    });

    it("loading ?category=smart-contract&min=500 initialises filters correctly", () => {
      const f = parseFiltersFromParams(
        new URLSearchParams("category=smart-contract&min=500"),
      );
      expect(f.category).toBe("Smart Contract");
      expect(f.minBudget).toBe("500");
    });

    it("encodes all canonical categories as slugs", () => {
      const cases: [string, string][] = [
        ["Frontend", "frontend"],
        ["Backend", "backend"],
        ["Smart Contract", "smart-contract"],
        ["Design", "design"],
        ["Mobile", "mobile"],
        ["Documentation", "documentation"],
        ["DevOps", "devops"],
      ];
      for (const [name, slug] of cases) {
        const params = filtersToParams({ ...defaults, category: name });
        expect(params.get("category")).toBe(slug);
      }
    });
  });
});
