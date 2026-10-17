#define main tracker_cli_main
#include "../src/main.cpp"
#undef main

void Require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

Json EmbeddedJson(const std::string& html, const std::string& id) {
    const auto tag = "<script id=\"" + id + "\" type=\"application/json\">";
    const auto start = html.find(tag);
    Require(start != std::string::npos, "Missing chart data: " + id);
    const auto end = html.find("</script>", start);
    return Json::parse(html.substr(start + tag.size(), end - start - tag.size()));
}

int main() {
    const auto path = std::filesystem::temp_directory_path() /
        ("diamond-history-test-" + std::to_string(std::chrono::high_resolution_clock::now().time_since_epoch().count()));
    try {
        std::filesystem::create_directory(path);
        Record legacy;
        legacy.timestampKst = "2026-10-18 09:00:00";
        legacy.dateKst = "2026-10-18";
        legacy.status = "ok";
        legacy.lowestPrice = "917";
        legacy.carat = "5.12";
        legacy.sourceUrl = LoosegrownPageUrl();
        auto oldSite = legacy;
        oldSite.carat = "12"; // A 5ct query's winner may happen to exceed 10ct.
        auto current = legacy;
        current.lowestPrice = "3000";
        current.carat = "10";
        current.minCarats = 10;
        current.sourceUrl = LoosegrownPageUrl(10);
        auto failed = current;
        failed.timestampKst = "2026-10-18 10:00:00";
        failed.status = "error";
        failed.lowestPrice.clear();
        auto empty = current;
        empty.sourceId = "carbonsparkle";
        empty.status = "no_matches";
        empty.lowestPrice.clear();
        oldSite.timestampKst = "2026-10-18 11:00:00";

        WriteCsv(path / "legacy.csv", {legacy});
        WriteCsv(path / "sites.csv", {oldSite, current, failed, empty, oldSite}, true);
        const auto legacyRows = ReadCsv(path / "legacy.csv");
        const auto sites = ReadCsv(path / "sites.csv");
        Require(legacyRows.size() == 1 && legacyRows[0].lowestPrice == "917", "Legacy history changed");
        Require(sites.size() == 5 && sites[0].minCarats == 0 && sites[1].minCarats == 10,
            "Query minimum metadata failed to round-trip");
        WriteTradingViewChartHtml(path / "chart.html", legacyRows, sites);
        std::ifstream input(path / "chart.html");
        const std::string html((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
        input.close();
        const auto siteJson = EmbeddedJson(html, "site-json");
        Require(siteJson.size() == 3, "Historical 5ct observations entered the 10ct series");
        Require(siteJson[0].at("value") == 3000 && siteJson[0].at("minCarats") == 10, "Ten-carat success missing");
        Require(siteJson[1].at("status") == "error" && siteJson[2].at("status") == "no_matches",
            "Ten-carat failure/empty coverage was lost");
        Require(EmbeddedJson(html, "daily-json")[0].at("value") == 917, "Legacy chart used the ten-carat quote");
        Require(EmbeddedJson(html, "sources-json")[0].at("url") == LoosegrownPageUrl(10), "LGD comparison link mismatched");

        {
            const TemporaryJsonBody first(BuildLoosegrownRequest(1, 5));
            const TemporaryJsonBody second(BuildLoosegrownRequest(1, 10));
            Require(first.path != second.path, "Concurrent LGD bodies share a request file");
            Json body;
            std::ifstream(first.path) >> body;
            Require(body.at("carat_range") == "5,51.03", "Legacy body was overwritten");
            std::ifstream(second.path) >> body;
            Require(body.at("carat_range") == "10,51.03", "Comparison body was overwritten");
        }
        for (const auto& file : {"legacy.csv", "sites.csv", "chart.html"}) std::filesystem::remove(path / file);
        std::filesystem::remove(path);
        std::cout << "Tracking history, carat cohort separation and isolated request files passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
