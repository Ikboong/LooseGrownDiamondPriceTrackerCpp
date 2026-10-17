#include <cstdio>
#include <cstdlib>

#include <algorithm>
#include <atomic>
#include <future>
#include <map>
#include <set>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "nivoda.h"
#include "loosegrown.h"
#include "chart_template.h"

struct PriceResult {
    double lowestPrice = std::numeric_limits<double>::infinity();
    double basePrice = std::numeric_limits<double>::infinity();
    double originalPrice = std::numeric_limits<double>::infinity();
    int discountPercent = 0;
    int totalMatches = 0;
    std::string sku;
    std::string carat;
    std::string id;
    std::string status = "ok";
    std::string message;
};

struct Record {
    std::string timestampKst;
    std::string dateKst;
    std::string lowestPrice;
    std::string originalPrice;
    std::string basePrice;
    std::string discountPercent;
    std::string sku;
    std::string carat;
    std::string id;
    std::string totalMatches;
    std::string status;
    std::string message;
    std::string sourceUrl;
    std::string sourceId = "loosegrown";
    std::string currency = "USD";
    double minCarats = 0;
};

const std::vector<std::string> kCsvHeader = {
    "TimestampKST",
    "DateKST",
    "LowestPrice",
    "OriginalPrice",
    "BasePrice",
    "DiscountPercent",
    "SKU",
    "Carat",
    "ID",
    "TotalMatches",
    "Status",
    "Message",
    "SourceUrl",
};

std::string RunCommand(const std::string& command) {
    FILE* pipe = _popen(command.c_str(), "r");
    if (!pipe) throw std::runtime_error("failed to start command");

    std::string output;
    char buffer[4096];
    while (fgets(buffer, sizeof(buffer), pipe)) output += buffer;

    int code = _pclose(pipe);
    if (code != 0) {
        std::ostringstream msg;
        msg << "command failed with code " << code;
        throw std::runtime_error(msg.str());
    }
    return output;
}

std::string Base64Decode(const std::string& input) {
    static const std::string table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::vector<int> map(256, -1);
    for (int i = 0; i < 64; ++i) map[(unsigned char)table[i]] = i;

    std::string out;
    int val = 0;
    int bits = -8;
    for (unsigned char c : input) {
        if (map[c] == -1) break;
        val = (val << 6) + map[c];
        bits += 6;
        if (bits >= 0) {
            out.push_back(char((val >> bits) & 0xff));
            bits -= 8;
        }
    }
    return out;
}

std::string EvalStringExpression(const std::string& expr) {
    std::regex token(R"re('([^']*)'|"([^"]*)"|String\.fromCharCode\(([0-9]+)\))re");
    std::string out;
    for (std::sregex_iterator it(expr.begin(), expr.end(), token), end; it != end; ++it) {
        if ((*it)[1].matched) out += (*it)[1].str();
        else if ((*it)[2].matched) out += (*it)[2].str();
        else out.push_back((char)std::stoi((*it)[3].str()));
    }
    return out;
}

std::string ExtractSucuriCookie(const std::string& html) {
    std::smatch match;
    if (!std::regex_search(html, match, std::regex(R"(S='([^']+)')"))) return "";

    std::string script = Base64Decode(match[1].str());
    size_t valueEq = script.find('=');
    size_t valueEnd = script.find(";document.cookie");
    size_t cookieStart = script.find("document.cookie=");
    size_t eqPos = script.find("\"=\"", cookieStart);
    if (valueEq == std::string::npos || valueEnd == std::string::npos || valueEq > valueEnd ||
        cookieStart == std::string::npos || eqPos == std::string::npos) {
        return "";
    }

    std::string value = EvalStringExpression(script.substr(valueEq + 1, valueEnd - (valueEq + 1)));
    std::string name = EvalStringExpression(script.substr(cookieStart + 16, eqPos - (cookieStart + 16)));
    return name + "=" + value;
}

std::string CsvEscape(const std::string& value) {
    bool quote = value.find_first_of(",\"\r\n") != std::string::npos;
    if (!quote) return value;

    std::string out = "\"";
    for (char ch : value) {
        if (ch == '"') out += "\"\"";
        else out.push_back(ch);
    }
    out += '"';
    return out;
}

std::vector<std::string> ParseCsvLine(const std::string& line) {
    std::vector<std::string> fields;
    std::string current;
    bool inQuotes = false;

    for (size_t i = 0; i < line.size(); ++i) {
        char ch = line[i];
        if (inQuotes) {
            if (ch == '"' && i + 1 < line.size() && line[i + 1] == '"') {
                current.push_back('"');
                ++i;
            } else if (ch == '"') {
                inQuotes = false;
            } else {
                current.push_back(ch);
            }
        } else if (ch == ',') {
            fields.push_back(current);
            current.clear();
        } else if (ch == '"') {
            inQuotes = true;
        } else {
            current.push_back(ch);
        }
    }

    fields.push_back(current);
    return fields;
}

std::string FormatNumber(double value) {
    if (!std::isfinite(value)) return "";
    std::ostringstream out;
    out << std::fixed << std::setprecision(2) << value;
    auto text = out.str();
    while (text.back() == '0') text.pop_back();
    if (text.back() == '.') text.pop_back();
    return text;
}

bool IsNumber(const std::string& value) {
    if (value.empty()) return false;
    try {
        size_t used = 0;
        const auto number = std::stod(value, &used);
        return used == value.size() && std::isfinite(number) && number > 0;
    } catch (const std::exception&) {
        return false;
    }
}

std::pair<std::string, std::string> CurrentKstTimestamp() {
    auto now = std::chrono::system_clock::now() + std::chrono::hours(9);
    std::time_t tt = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
    gmtime_s(&tm, &tt);

    std::ostringstream ts;
    ts << std::put_time(&tm, "%Y-%m-%d %H:%M:%S");
    std::ostringstream date;
    date << std::put_time(&tm, "%Y-%m-%d");
    return {ts.str(), date.str()};
}

std::vector<Record> ReadCsv(const std::filesystem::path& path) {
    std::vector<Record> records;
    std::ifstream input(path);
    if (!input) return records;

    std::string line;
    std::getline(input, line);
    while (std::getline(input, line)) {
        auto fields = ParseCsvLine(line);
        if (fields.size() < kCsvHeader.size()) fields.resize(kCsvHeader.size());
        Record record{
            fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[6],
            fields[7], fields[8], fields[9], fields[10], fields[11], fields[12],
        };
        if (fields.size() > 13) record.sourceId = fields[13];
        if (fields.size() > 14) record.currency = fields[14];
        if (fields.size() > 15 && IsNumber(fields[15])) record.minCarats = std::stod(fields[15]);
        records.push_back(record);
    }
    return records;
}

void WriteCsv(const std::filesystem::path& path, const std::vector<Record>& records, bool siteHistory = false) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write CSV: " + path.string());

    auto header = kCsvHeader;
    if (siteHistory) { header.push_back("SourceId"); header.push_back("Currency"); header.push_back("MinCarats"); }
    for (size_t i = 0; i < header.size(); ++i) {
        if (i) output << ",";
        output << header[i];
    }
    output << "\n";

    for (const auto& r : records) {
        std::vector<std::string> fields = {
            r.timestampKst, r.dateKst, r.lowestPrice, r.originalPrice, r.basePrice,
            r.discountPercent, r.sku, r.carat, r.id, r.totalMatches, r.status, r.message, r.sourceUrl,
        };
        if (siteHistory) {
            fields.push_back(r.sourceId); fields.push_back(r.currency);
            fields.push_back(r.minCarats > 0 ? FormatNumber(r.minCarats) : "");
        }
        for (size_t i = 0; i < fields.size(); ++i) {
            if (i) output << ",";
            output << CsvEscape(fields[i]);
        }
        output << "\n";
    }
    if (!output) throw std::runtime_error("failed while writing CSV: " + path.string());
}

Json RecordJson(const Record& record) {
    Json row = {
        {"time", record.dateKst}, {"timestamp", record.timestampKst},
        {"value", nullptr}, {"original", 0}, {"sku", record.sku},
        {"carat", record.carat}, {"totalMatches", record.totalMatches},
        {"siteId", record.sourceId}, {"status", record.status},
        {"message", record.message}, {"currency", record.currency},
        {"sourceUrl", record.sourceUrl},
        {"minCarats", record.minCarats},
    };
    if (record.status == "ok" && IsNumber(record.lowestPrice)) row["value"] = std::stod(record.lowestPrice);
    if (IsNumber(record.originalPrice)) row["original"] = std::stod(record.originalPrice);
    return row;
}

void WriteTradingViewChartHtml(const std::filesystem::path& path, const std::vector<Record>& records,
                              const std::vector<Record>& siteRecords) {
    std::map<std::string, Record> latestByDate;
    for (const auto& record : records) {
        if (record.status == "ok" && IsNumber(record.lowestPrice)) latestByDate[record.dateKst] = record;
    }
    auto daily = Json::array();
    for (const auto& entry : latestByDate) daily.push_back(RecordJson(entry.second));
    auto sites = Json::array();
    for (const auto& record : siteRecords) {
        if (record.minCarats == kAllSitesMinCarats) sites.push_back(RecordJson(record));
    }
    Json sources = Json::array({{{"id", "loosegrown"}, {"name", "Loose Grown Diamond"}, {"url", LoosegrownPageUrl(kAllSitesMinCarats)}}});
    for (const auto& source : NivodaSources()) {
        sources.push_back({{"id", source.id}, {"name", source.name}, {"url", source.pageUrl}});
    }
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write chart HTML: " + path.string());
    output << RenderChartHtml(daily.dump(), sites.dump(), sources.dump());
    if (!output) throw std::runtime_error("failed while writing chart HTML");
}

struct TemporaryJsonBody {
    std::filesystem::path path;
    explicit TemporaryJsonBody(const Json& body) {
        static std::atomic<unsigned long long> serial{0};
        const auto ticks = std::chrono::high_resolution_clock::now().time_since_epoch().count();
        path = std::filesystem::temp_directory_path() /
            ("diamond-request-" + std::to_string(ticks) + "-" + std::to_string(serial++) + ".json");
        std::ofstream output(path, std::ios::binary);
        if (!output) throw std::runtime_error("cannot create API request file");
        output << body.dump();
        if (!output) throw std::runtime_error("cannot write API request file");
    }
    ~TemporaryJsonBody() { std::error_code error; std::filesystem::remove(path, error); }
};

PriceResult FetchLowestPrice(int minCarats) {
    const std::string apiUrl = "https://www.loosegrowndiamond.com/wp-json/ls/v1/inventory-colored";
    const auto pageUrl = LoosegrownPageUrl(minCarats);

    std::string challengeHtml = RunCommand("curl.exe --fail --connect-timeout 15 --max-time 60 -sS -L -A \"Mozilla/5.0\" \"" + pageUrl + "\"");
    std::string cookie = ExtractSucuriCookie(challengeHtml);
    if (cookie.empty()) throw std::runtime_error("could not extract Sucuri challenge cookie");

    PriceResult best;
    const int perPage = 50;

    for (int page = 1; page <= 100; ++page) {
        const TemporaryJsonBody body(BuildLoosegrownRequest(page, minCarats));

        std::string command =
            "curl.exe --fail --connect-timeout 15 --max-time 60 -sS -L -A \"Mozilla/5.0\" "
            "-H \"Content-Type: application/json\" "
            "-H \"Accept: application/json, text/plain, */*\" "
            "-H \"Referer: " + pageUrl + "\" "
            "-b \"" + cookie + "\" "
            "--data-binary \"@" + body.path.string() + "\" "
            "\"" + apiUrl + "\"";

        const auto inventory = ParseLoosegrownInventory(RunCommand(command), minCarats);
        const auto total = inventory.at("total").get<int>();
        if (page == 1) best.totalMatches = total;
        else if (total != best.totalMatches) throw std::runtime_error("Loose Grown Diamond inventory changed during pagination");
        if (total == 0) {
            best.status = "no_matches";
            best.message = "No diamonds match the supplied search filters";
            return best;
        }
        for (const auto& item : inventory.at("data")) {
            // The API price is already the colored-diamond display price.
            const auto displayedPrice = JsonPrice(item.at("price"));
            if (displayedPrice >= best.lowestPrice) continue;
            const auto originalField = item.value("org_price", Json());
            const auto originalPrice = originalField.is_null() || originalField == ""
                ? displayedPrice : JsonPrice(originalField);
            const auto text = [](const Json& value) {
                return value.is_string() ? value.get<std::string>() : value.dump();
            };
            best.lowestPrice = displayedPrice;
            best.basePrice = displayedPrice;
            best.originalPrice = originalPrice;
            best.discountPercent = originalPrice > displayedPrice
                ? static_cast<int>(std::lround((1 - displayedPrice / originalPrice) * 100)) : 0;
            best.sku = text(item.at("sku"));
            best.carat = text(item.at("carat"));
            best.id = text(item.at("id"));
        }

        if (page * perPage >= best.totalMatches) break;
    }

    if (!std::isfinite(best.lowestPrice)) {
        throw std::runtime_error("no matching diamonds found");
    }

    best.message = "ok";
    return best;
}

Json PostJson(const std::string& url, const Json& body) {
    TemporaryJsonBody file(body);
    const auto command = "curl.exe --fail --connect-timeout 15 --max-time 60 -sS -L "
        "-A \"Mozilla/5.0\" -H \"Content-Type: application/json\" --data-binary \"@"
        + file.path.string() + "\" \"" + url + "\"";
    return Json::parse(RunCommand(command));
}

PriceResult FetchNivodaLowestPrice(const NivodaSource& source) {
    const auto request = BuildNivodaRequest(source);
    const auto countResponse = PostJson(source.origin + "/apps/diamond-proxy/api/count",
        {{"callFrom", "feed"}, {"query", request.at("query")}});
    const auto& countValue = countResponse.at("data").at("diamonds_by_query_count");
    if (!countValue.is_number_integer()) throw std::runtime_error("invalid inventory count");
    const int count = countValue.get<int>();
    if (count < 0 || count > 10000) throw std::runtime_error("inventory count outside supported range");
    PriceResult best;
    best.totalMatches = count;
    if (count == 0) {
        best.status = "no_matches";
        best.message = "No diamonds match the supplied search filters";
        return best;
    }
    std::set<std::string> ids;
    int offset = 0;
    while (offset < count) {
        const auto feed = PostJson(source.origin + "/apps/diamond-proxy/api/v2/feed", BuildNivodaRequest(source, offset));
        if (!feed.is_array() || feed.empty()) throw std::runtime_error("inventory feed ended before its advertised count");
        for (const auto& item : feed) {
            const auto quote = ParseNivodaQuote(item, source);
            if (!ids.insert(quote.id).second) throw std::runtime_error("duplicate inventory id across pages; collection is incomplete");
            if (quote.price >= best.lowestPrice) continue;
            best.lowestPrice = quote.price;
            best.basePrice = quote.price;
            best.originalPrice = quote.originalPrice;
            best.discountPercent = quote.originalPrice > quote.price
                ? static_cast<int>(std::lround((1 - quote.price / quote.originalPrice) * 100)) : 0;
            best.sku = quote.id;
            best.id = quote.id;
            best.carat = quote.carat;
        }
        offset += static_cast<int>(feed.size());
    }
    if (static_cast<int>(ids.size()) != count) throw std::runtime_error("inventory changed during pagination; retrying the complete snapshot");
    best.message = "ok";
    return best;
}

Record CollectSource(const std::string& id, bool legacy = false) {
    Record record;
    const auto timestamp = CurrentKstTimestamp();
    record.timestampKst = timestamp.first;
    record.dateKst = timestamp.second;
    record.sourceId = id;
    const auto& sources = NivodaSources();
    const auto found = std::find_if(sources.begin(), sources.end(), [&](const NivodaSource& source) { return source.id == id; });
    record.minCarats = legacy ? 5 : kAllSitesMinCarats;
    record.sourceUrl = id == "loosegrown" ? LoosegrownPageUrl(static_cast<int>(record.minCarats)) : found->pageUrl;
    try {
        PriceResult result;
        for (int attempt = 1; attempt <= 3; ++attempt) {
            try {
                result = id == "loosegrown" ? FetchLowestPrice(static_cast<int>(record.minCarats)) : FetchNivodaLowestPrice(*found);
                break;
            } catch (const std::exception& error) {
                std::cerr << id << " attempt " << attempt << " failed: " << error.what() << "\n";
                if (attempt == 3) throw;
                std::this_thread::sleep_for(std::chrono::seconds(5));
            }
        }
        record.lowestPrice = FormatNumber(result.lowestPrice);
        record.originalPrice = FormatNumber(result.originalPrice);
        record.basePrice = FormatNumber(result.basePrice);
        record.discountPercent = std::to_string(result.discountPercent);
        record.sku = result.sku;
        record.carat = result.carat;
        record.id = result.id;
        record.totalMatches = std::to_string(result.totalMatches);
        record.status = result.status;
        record.message = result.message;
    } catch (const std::exception& error) {
        record.status = "error";
        record.message = error.what();
    }
    const auto observed = CurrentKstTimestamp();
    record.timestampKst = observed.first;
    record.dateKst = observed.second;
    return record;
}

int main(int argc, char** argv) {
    try {
        std::filesystem::path outputDir = "data";
        bool chartOnly = false;
        std::string sourceFilter;
        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i];
            if (arg == "--output-dir" && i + 1 < argc) outputDir = argv[++i];
            else if (arg == "--source" && i + 1 < argc) sourceFilter = argv[++i];
            else if (arg == "--chart-only") chartOnly = true;
            else if (arg == "--help" || arg == "-h") {
                std::cout << "Usage: LooseGrownDiamondPriceTracker.exe [--output-dir data] [--chart-only] [--source loosegrown|carbonsparkle|aurelinne|altura]\n";
                return 0;
            } else throw std::runtime_error("unknown or incomplete argument: " + arg);
        }
        const auto csvPath = outputDir / "loosegrown_price_history.csv";
        const auto sitesPath = outputDir / "site_price_history.csv";
        auto records = ReadCsv(csvPath);
        auto siteRecords = ReadCsv(sitesPath);
        std::vector<std::string> sourceIds = {"loosegrown"};
        for (const auto& source : NivodaSources()) sourceIds.push_back(source.id);
        if (!sourceFilter.empty() && std::find(sourceIds.begin(), sourceIds.end(), sourceFilter) == sourceIds.end()) {
            throw std::runtime_error("unknown source: " + sourceFilter);
        }
        if (!chartOnly) {
            std::future<Record> legacy;
            if (sourceFilter.empty() || sourceFilter == "loosegrown") {
                legacy = std::async(std::launch::async, CollectSource, "loosegrown", true);
            }
            std::vector<std::future<Record>> pending;
            for (const auto& id : sourceIds) {
                if (!sourceFilter.empty() && sourceFilter != id) continue;
                pending.push_back(std::async(std::launch::async, CollectSource, id, false));
            }
            for (auto& future : pending) {
                auto record = future.get();
                siteRecords.push_back(record);
                std::cout << record.sourceId << ": " << record.status << " price=" << record.lowestPrice
                    << " USD minCarats=" << record.minCarats << " matches=" << record.totalMatches << "\n";
                if (record.status != "ok") std::cout << "Message: " << record.message << "\n";
            }
            if (legacy.valid()) {
                auto record = legacy.get();
                std::cout << "loosegrown (legacy 5ct): " << record.status << " price=" << record.lowestPrice
                    << " USD matches=" << record.totalMatches << "\n";
                if (record.status != "ok") std::cout << "Message: " << record.message << "\n";
                records.push_back(record);
            }
            WriteCsv(csvPath, records);
            WriteCsv(sitesPath, siteRecords, true);
        }
        const auto chartPath = outputDir / "loosegrown_tradingview_chart.html";
        WriteTradingViewChartHtml(chartPath, records, siteRecords);
        std::cout << "Saved: " << chartPath.string() << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Tracker failed: " << error.what() << "\n";
        return 1;
    }
}
