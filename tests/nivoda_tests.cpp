#include "../src/nivoda.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <limits>
#include <sstream>

namespace {

void Require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

template <typename Function>
void RequireRejected(Function function, const std::string& label) {
    try {
        function();
    } catch (const std::exception&) {
        return;
    }
    throw std::runtime_error(label + ": invalid inventory was accepted");
}

Json LoadFixture(const std::filesystem::path& root, const std::string& source) {
    const auto path = root / ("nivoda-" + source + ".json");
    std::ifstream input(path);
    if (!input) throw std::runtime_error("Cannot open fixture: " + path.string());
    Json fixture;
    input >> fixture;
    return fixture;
}

const NivodaSource& Source(const std::string& id) {
    for (const auto& source : NivodaSources()) {
        if (source.id == id) return source;
    }
    throw std::runtime_error("Missing source: " + id);
}

struct Runner {
    int passed = 0;
    int failed = 0;

    void Run(const std::string& name, const std::function<void()>& test) {
        try {
            test();
            ++passed;
        } catch (const std::exception& error) {
            ++failed;
            std::cerr << "FAIL " << name << ": " << error.what() << '\n';
        }
    }
};

}  // namespace

int main(int argc, char** argv) {
#ifdef FIXTURE_DIR
    const auto defaultFixtureRoot = std::filesystem::path(FIXTURE_DIR);
#else
    const auto defaultFixtureRoot = std::filesystem::path(__FILE__).parent_path() / "fixtures";
#endif
    const auto fixtureRoot = argc > 1 ? std::filesystem::path(argv[1])
        : defaultFixtureRoot;
    Runner runner;

    runner.Run("three configured storefronts", [] {
        Require(NivodaSources().size() == 3, "Expected exactly the three added stores");
        Require(Source("carbonsparkle").origin == "https://www.carbonsparkle.com", "Carbon origin changed");
        Require(Source("aurelinne").origin == "https://aurelinne.com", "Aurelinne origin changed");
        Require(Source("altura").origin == "https://alturadiamonds.com", "Altura origin changed");
    });

    for (const auto& source : NivodaSources()) {
        runner.Run(source.id + " request matches observed storefront filters", [&] {
            const auto fixture = LoadFixture(fixtureRoot, source.id);
            Require(BuildNivodaRequest(source) == fixture.at("request"),
                "Request differs from independently captured storefront request");
            auto expected = fixture.at("request");
            expected["offset"] = 37;
            Require(BuildNivodaRequest(source, 37) == expected,
                "Offset must be an item offset without changing filters");
        });

        runner.Run(source.id + " parses every observed inventory item", [&] {
            const auto fixture = LoadFixture(fixtureRoot, source.id);
            const auto& items = fixture.at("items");
            Require(items.size() == fixture.at("expected_count").get<size_t>(), "Incomplete fixture");
            size_t mixedColors = 0;
            size_t nullCuts = 0;
            double minimum = std::numeric_limits<double>::infinity();
            for (const auto& item : items) {
                const auto quote = ParseNivodaQuote(item, source);
                const auto expectedPrice = item.at("price").get<double>();
                Require(quote.price == expectedPrice && quote.originalPrice == expectedPrice,
                    "Observed inventory price changed");
                Require(quote.id == item.at("id").get<std::string>(), "Inventory ID changed");
                Require(!quote.carat.empty(), "Missing normalized carat");
                minimum = std::min(minimum, quote.price);
                mixedColors += item.at("certificate").at("color") == "Fancy Vivid Orange Pink";
                nullCuts += item.at("certificate").at("cut").is_null();
            }
            Require(mixedColors == 1, "Fixture must cover the observed mixed-color stone");
            Require(nullCuts == items.size(), "Fixture must retain observed null-cut certificates");
            Require(minimum == fixture.at("expected_minimum").get<double>(), "Incorrect full-inventory minimum");
        });
    }

    Json valid;
    runner.Run("load mutation fixture", [&] {
        valid = LoadFixture(fixtureRoot, "carbonsparkle").at("items").at(0);
    });
    if (!valid.is_object()) {
        std::cerr << "Nivoda tests: " << runner.passed << " passed, " << runner.failed << " failed\n";
        return 1;
    }
    const auto& carbon = Source("carbonsparkle");

    runner.Run("per-item discounted price takes precedence exactly once", [&] {
        auto item = valid;
        item["price"] = 1000;
        item["discountedPrice"] = 800.25;
        const auto quote = ParseNivodaQuote(item, carbon);
        Require(quote.price == 800.25, "Discounted price must be used directly");
        Require(quote.originalPrice == 1000, "Original asking price must be preserved");
    });
    runner.Run("missing and null discounts preserve listed price", [&] {
        auto item = valid;
        item["price"] = 1000;
        Require(ParseNivodaQuote(item, carbon).price == 1000, "Unspecified discount applied");
        item["discountedPrice"] = nullptr;
        Require(ParseNivodaQuote(item, carbon).price == 1000, "Null discount applied");
    });
    runner.Run("falsy storefront discount fields preserve listed price", [&] {
        for (const auto& discount : std::vector<Json>{0, 0.0, false, ""}) {
            auto item = valid;
            item["price"] = 1000;
            item["discountedPrice"] = discount;
            Require(ParseNivodaQuote(item, carbon).price == 1000,
                "The storefront treats zero, false and empty discount fields as absent");
        }
    });
    runner.Run("numeric strings retain their value and normalize carat", [&] {
        auto item = valid;
        item["price"] = "1234.50";
        item["certificate"]["carats"] = "5.12";
        const auto quote = ParseNivodaQuote(item, carbon);
        Require(quote.price == 1234.5, "Numeric price text changed");
        Require(quote.carat == "5.12", "Numeric carat text must not retain JSON string quotes");
    });
    runner.Run("explicit USD and requested color/intensity bounds accepted", [&] {
        for (const auto& color : {"Fancy Deep Pink", "Fancy Vivid Red", "Fancy Deep Red", "Fancy Vivid Orange Pink"}) {
            auto item = valid;
            item["currency"] = "USD";
            item["certificate"]["color"] = color;
            item["certificate"]["cut"] = "ID";
            Require(ParseNivodaQuote(item, carbon).price > 0, "Valid requested color rejected");
        }
    });
    runner.Run("inclusive carat and clarity bounds accepted", [&] {
        for (const auto& source : NivodaSources()) {
            for (const auto carats : {5, source.maxCarats}) {
                for (const auto& clarity : {"VVS2", "VVS1", "IF", "FL"}) {
                    auto item = valid;
                    item["certificate"]["carats"] = carats;
                    item["certificate"]["clarity"] = clarity;
                    Require(ParseNivodaQuote(item, source).price > 0, "Inclusive filter boundary rejected");
                }
            }
        }
    });
    runner.Run("each source accepts its configured certificate labs", [&] {
        for (const auto& source : NivodaSources()) {
            for (const auto& lab : source.labs) {
                auto item = valid;
                item["certificate"]["lab"] = lab;
                Require(ParseNivodaQuote(item, source).price > 0, "Configured certificate lab rejected");
            }
        }
    });

    auto RejectItem = [&](const std::string& label, const Json& item, const NivodaSource& source) {
        runner.Run(label, [&] {
            RequireRejected([&] { ParseNivodaQuote(item, source); }, label);
        });
    };
    auto RejectMutation = [&](const std::string& label, const std::function<void(Json&)>& mutate) {
        auto item = valid;
        mutate(item);
        RejectItem(label, item, carbon);
    };

    RejectItem("null inventory", nullptr, carbon);
    RejectItem("array inventory", Json::array(), carbon);
    RejectMutation("missing certificate", [](Json& item) { item.erase("certificate"); });
    RejectMutation("null certificate", [](Json& item) { item["certificate"] = nullptr; });
    RejectMutation("missing asking price", [](Json& item) { item.erase("price"); });
    RejectMutation("null asking price", [](Json& item) { item["price"] = nullptr; });
    RejectMutation("zero asking price", [](Json& item) { item["price"] = 0; });
    RejectMutation("negative asking price", [](Json& item) { item["price"] = -1; });
    RejectMutation("boolean asking price", [](Json& item) { item["price"] = true; });
    RejectMutation("object asking price", [](Json& item) { item["price"] = Json::object(); });
    RejectMutation("malformed asking-price string", [](Json& item) { item["price"] = "917USD"; });
    RejectMutation("empty asking-price string", [](Json& item) { item["price"] = ""; });
    RejectMutation("nonfinite asking price", [](Json& item) { item["price"] = std::numeric_limits<double>::infinity(); });
    RejectMutation("NaN asking-price string", [](Json& item) { item["price"] = "nan"; });
    RejectMutation("truthy zero-string discount is invalid", [](Json& item) { item["discountedPrice"] = "0"; });
    RejectMutation("malformed discount does not fall back", [](Json& item) { item["discountedPrice"] = "invalid"; });
    RejectMutation("negative discount", [](Json& item) { item["discountedPrice"] = -100; });
    RejectMutation("EUR quote", [](Json& item) { item["currency"] = "EUR"; });
    RejectMutation("null currency", [](Json& item) { item["currency"] = nullptr; });
    RejectMutation("missing id", [](Json& item) { item.erase("id"); });
    RejectMutation("empty id", [](Json& item) { item["id"] = ""; });
    RejectMutation("null id", [](Json& item) { item["id"] = nullptr; });
    RejectMutation("missing carat", [](Json& item) { item["certificate"].erase("carats"); });
    RejectMutation("null carat", [](Json& item) { item["certificate"]["carats"] = nullptr; });
    RejectMutation("zero carat", [](Json& item) { item["certificate"]["carats"] = 0; });
    RejectMutation("carat below five", [](Json& item) { item["certificate"]["carats"] = 4.99; });
    RejectMutation("carat above fifty", [](Json& item) { item["certificate"]["carats"] = 50.01; });
    for (const auto& source : {Source("aurelinne"), Source("altura")}) {
        auto item = valid;
        item["certificate"]["carats"] = 20.01;
        RejectItem(source.id + " carat above twenty", item, source);
    }
    RejectMutation("natural diamond", [](Json& item) { item["certificate"]["labgrown"] = false; });
    RejectMutation("null labgrown flag", [](Json& item) { item["certificate"]["labgrown"] = nullptr; });
    RejectMutation("round diamond", [](Json& item) { item["certificate"]["shape"] = "ROUND"; });
    RejectMutation("null shape", [](Json& item) { item["certificate"]["shape"] = nullptr; });
    RejectMutation("lower clarity", [](Json& item) { item["certificate"]["clarity"] = "VS1"; });
    RejectMutation("null clarity", [](Json& item) { item["certificate"]["clarity"] = nullptr; });
    RejectMutation("weaker fancy intensity", [](Json& item) { item["certificate"]["color"] = "Fancy Intense Pink"; });
    RejectMutation("different fancy color", [](Json& item) { item["certificate"]["color"] = "Fancy Vivid Blue"; });
    RejectMutation("null color", [](Json& item) { item["certificate"]["color"] = nullptr; });
    RejectMutation("nonideal explicit cut", [](Json& item) { item["certificate"]["cut"] = "EX"; });
    RejectMutation("missing certificate lab", [](Json& item) { item["certificate"].erase("lab"); });
    RejectMutation("null certificate lab", [](Json& item) { item["certificate"]["lab"] = nullptr; });
    RejectMutation("unrequested certificate lab", [](Json& item) { item["certificate"]["lab"] = "HRD"; });
    auto alturaWrongLab = valid;
    alturaWrongLab["certificate"]["lab"] = "GCAL";
    RejectItem("Altura excludes GCAL even though Carbon includes it", alturaWrongLab, Source("altura"));

    std::cout << "Nivoda tests: " << runner.passed << " passed, " << runner.failed << " failed\n";
    return runner.failed ? 1 : 0;
}
