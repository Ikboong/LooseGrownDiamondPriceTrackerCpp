#include <cstdio>
#include <cstdlib>

#include <algorithm>
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
#include <vector>

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
};

const std::string kPageUrl =
    "https://www.loosegrowndiamond.com/lab-created-colored-diamonds/"
    "?shape=heart&carat=5.00,51.03&certificate=1,2&intensity=4"
    "&cut=3.00,4.00&color=pink&clarity=7.00,11.00";

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

int ExtractDiscountPercent(const std::string& html) {
    std::regex r(R"re(Save\s+([0-9]+)\s*%\s+on\s+Lab\s+Diamonds)re", std::regex_constants::icase);
    std::smatch m;
    if (!std::regex_search(html, m, r)) return 0;

    int percent = std::stoi(m[1].str());
    if (percent < 0 || percent > 95) return 0;
    return percent;
}

int JsonIntField(const std::string& text, const std::string& field) {
    std::regex r("\"" + field + R"re("\s*:\s*([0-9]+))re");
    std::smatch m;
    return std::regex_search(text, m, r) ? std::stoi(m[1].str()) : 0;
}

std::string JsonStringField(const std::string& object, const std::string& field) {
    std::regex r("\"" + field + R"re("\s*:\s*"([^"]*)")re");
    std::smatch m;
    return std::regex_search(object, m, r) ? m[1].str() : "";
}

std::vector<std::string> ExtractDataObjects(const std::string& json) {
    std::vector<std::string> objects;
    size_t dataPos = json.find("\"data\"");
    size_t arrayStart = json.find('[', dataPos);
    if (arrayStart == std::string::npos) return objects;

    bool inString = false;
    bool escape = false;
    int depth = 0;
    size_t objStart = std::string::npos;

    for (size_t i = arrayStart + 1; i < json.size(); ++i) {
        char ch = json[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch == '\\' && inString) {
            escape = true;
            continue;
        }
        if (ch == '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch == '{') {
            if (depth == 0) objStart = i;
            ++depth;
        } else if (ch == '}') {
            --depth;
            if (depth == 0 && objStart != std::string::npos) {
                objects.push_back(json.substr(objStart, i - objStart + 1));
                objStart = std::string::npos;
            }
        } else if (ch == ']' && depth == 0) {
            break;
        }
    }

    return objects;
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
    out << std::fixed << std::setprecision(0) << value;
    return out.str();
}

bool IsNumber(const std::string& value) {
    if (value.empty()) return false;
    return std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return (ch >= '0' && ch <= '9') || ch == '.';
    });
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
        records.push_back({
            fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[6],
            fields[7], fields[8], fields[9], fields[10], fields[11], fields[12],
        });
    }
    return records;
}

void WriteCsv(const std::filesystem::path& path, const std::vector<Record>& records) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write CSV: " + path.string());

    for (size_t i = 0; i < kCsvHeader.size(); ++i) {
        if (i) output << ",";
        output << kCsvHeader[i];
    }
    output << "\n";

    for (const auto& r : records) {
        const std::vector<std::string> fields = {
            r.timestampKst, r.dateKst, r.lowestPrice, r.originalPrice, r.basePrice,
            r.discountPercent, r.sku, r.carat, r.id, r.totalMatches, r.status, r.message, r.sourceUrl,
        };
        for (size_t i = 0; i < fields.size(); ++i) {
            if (i) output << ",";
            output << CsvEscape(fields[i]);
        }
        output << "\n";
    }
}

std::string XmlEscape(const std::string& value) {
    std::string out;
    for (char ch : value) {
        switch (ch) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            default: out.push_back(ch); break;
        }
    }
    return out;
}

std::string JsonEscape(const std::string& value) {
    std::string out;
    for (char ch : value) {
        switch (ch) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out.push_back(ch); break;
        }
    }
    return out;
}

void WriteTradingViewChartHtml(const std::filesystem::path& path, const std::vector<Record>& records) {
    struct DailyPoint {
        std::string date;
        double price;
        double originalPrice;
        std::string sku;
        std::string carat;
    };

    std::vector<DailyPoint> points;
    for (const auto& r : records) {
        if (r.status == "ok" && IsNumber(r.lowestPrice)) {
            double original = IsNumber(r.originalPrice) ? std::stod(r.originalPrice) : 0.0;
            points.push_back({r.dateKst, std::stod(r.lowestPrice), original, r.sku, r.carat});
        }
    }

    std::filesystem::create_directories(path.parent_path());
    std::ofstream html(path, std::ios::binary);
    if (!html) throw std::runtime_error("cannot write TradingView chart HTML: " + path.string());

    std::ostringstream data;
    data << "[";
    for (size_t i = 0; i < points.size(); ++i) {
        if (i) data << ",";
        data << "{\"time\":\"" << JsonEscape(points[i].date) << "\","
             << "\"value\":" << std::fixed << std::setprecision(0) << points[i].price << ","
             << "\"original\":" << std::fixed << std::setprecision(0) << points[i].originalPrice << ","
             << "\"sku\":\"" << JsonEscape(points[i].sku) << "\","
             << "\"carat\":\"" << JsonEscape(points[i].carat) << "\"}";
    }
    data << "]";

    html << R"html(<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loose Grown Diamond Price Tracker</title>
  <script src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #172026; background: #f7f8fa; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px 18px 36px; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 24px; line-height: 1.2; }
    .meta { color: #5f6b76; font-size: 13px; text-align: right; }
    .chart-block { background: #fff; border: 1px solid #d9dee4; border-radius: 6px; margin-top: 14px; padding: 14px; }
    .chart-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .chart-title h2 { margin: 0; font-size: 16px; }
    .last { color: #0f766e; font-weight: 700; font-size: 14px; }
    #dailyChart, #weeklyChart { width: 100%; height: 360px; }
    .empty { background: #fff; border: 1px solid #d9dee4; border-radius: 6px; padding: 28px; color: #5f6b76; }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Loose Grown Diamond Lowest Displayed Price</h1>
    </div>
    <div class="meta" id="meta"></div>
  </header>
  <div id="content"></div>
</main>
<script>
const dailyData = )html" << data.str() << R"html(;

function formatPrice(price) {
  return '$' + Math.round(price).toLocaleString('en-US');
}

function weekStartIso(isoDate) {
  const date = new Date(isoDate + 'T00:00:00Z');
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function toWeeklyCandles(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const week = weekStartIso(row.time);
    if (!grouped.has(week)) {
      grouped.set(week, { time: week, open: row.value, high: row.value, low: row.value, close: row.value });
    } else {
      const candle = grouped.get(week);
      candle.high = Math.max(candle.high, row.value);
      candle.low = Math.min(candle.low, row.value);
      candle.close = row.value;
    }
  }
  return Array.from(grouped.values());
}

function chartOptions() {
  return {
    layout: { background: { color: '#ffffff' }, textColor: '#2f3a45' },
    grid: { vertLines: { color: '#eef1f4' }, horzLines: { color: '#eef1f4' } },
    rightPriceScale: { borderColor: '#d9dee4' },
    timeScale: { borderColor: '#d9dee4', timeVisible: false },
    localization: { priceFormatter: formatPrice },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  };
}

const content = document.getElementById('content');
if (!dailyData.length) {
  content.innerHTML = '<div class="empty">No successful data yet.</div>';
} else {
  const last = dailyData[dailyData.length - 1];
  document.getElementById('meta').textContent =
    `Last ${last.time} · Final ${formatPrice(last.value)} · Original ${formatPrice(last.original)} · SKU ${last.sku}`;
  content.innerHTML = `
    <section class="chart-block">
      <div class="chart-title"><h2>Daily Line Chart</h2><div class="last">${formatPrice(last.value)}</div></div>
      <div id="dailyChart"></div>
    </section>
    <section class="chart-block">
      <div class="chart-title"><h2>Weekly Candlestick Chart</h2><div class="last">OHLC from daily closes</div></div>
      <div id="weeklyChart"></div>
    </section>`;

  const dailyChart = LightweightCharts.createChart(document.getElementById('dailyChart'), chartOptions());
  const line = dailyChart.addLineSeries({ color: '#0f766e', lineWidth: 2, priceLineVisible: true });
  line.setData(dailyData.map(row => ({ time: row.time, value: row.value })));
  dailyChart.timeScale().fitContent();

  const weeklyChart = LightweightCharts.createChart(document.getElementById('weeklyChart'), chartOptions());
  const candles = weeklyChart.addCandlestickSeries({
    upColor: '#0f766e',
    downColor: '#dc2626',
    borderUpColor: '#0f766e',
    borderDownColor: '#dc2626',
    wickUpColor: '#0f766e',
    wickDownColor: '#dc2626',
  });
  candles.setData(toWeeklyCandles(dailyData));
  weeklyChart.timeScale().fitContent();

  const resize = () => {
    dailyChart.applyOptions({ width: document.getElementById('dailyChart').clientWidth });
    weeklyChart.applyOptions({ width: document.getElementById('weeklyChart').clientWidth });
  };
  window.addEventListener('resize', resize);
  resize();
}
</script>
</body>
</html>
)html";
}

PriceResult FetchLowestPrice() {
    const std::string apiUrl = "https://www.loosegrowndiamond.com/wp-json/ls/v1/inventory-colored";

    std::string challengeHtml = RunCommand("curl.exe -sS -L -A \"Mozilla/5.0\" \"" + kPageUrl + "\"");
    std::string cookie = ExtractSucuriCookie(challengeHtml);
    if (cookie.empty()) throw std::runtime_error("could not extract Sucuri challenge cookie");

    std::string fullHtml = RunCommand(
        "curl.exe -sS -L -A \"Mozilla/5.0\" -b \"" + cookie + "\" \"" + kPageUrl + "\"");
    int discountPercent = ExtractDiscountPercent(fullHtml);
    double discountMultiplier = (100.0 - discountPercent) / 100.0;

    PriceResult best;
    best.discountPercent = discountPercent;
    const int perPage = 50;
    const std::string bodyFile = "loosegrown_body.json";

    for (int page = 1; page <= 100; ++page) {
        {
            std::ofstream body(bodyFile, std::ios::binary);
            body << "{\"ls_start\":" << page
                 << ",\"ls_per_page\":50"
                 << ",\"carat_range\":\"5,51.03\""
                 << ",\"cut_range\":\"3,4\""
                 << ",\"colored\":\"2\""
                 << ",\"clarity_range\":\"7,11\""
                 << ",\"intensity\":[4]"
                 << ",\"certificate_type\":[\"1\",\"2\"]"
                 << ",\"shape\":[\"heart\"]}";
        }

        std::string command =
            "curl.exe -sS -L -A \"Mozilla/5.0\" "
            "-H \"Content-Type: application/json\" "
            "-H \"Accept: application/json, text/plain, */*\" "
            "-H \"Referer: " + kPageUrl + "\" "
            "-b \"" + cookie + "\" "
            "--data-binary \"@" + bodyFile + "\" "
            "\"" + apiUrl + "\"";

        std::string json = RunCommand(command);
        if (best.totalMatches == 0) best.totalMatches = JsonIntField(json, "total");

        for (const std::string& object : ExtractDataObjects(json)) {
            std::string basePriceText = JsonStringField(object, "price");
            if (basePriceText.empty()) continue;

            double basePrice = std::stod(basePriceText);
            double finalPrice = std::round(basePrice * discountMultiplier);
            if (finalPrice < best.lowestPrice) {
                best.lowestPrice = finalPrice;
                best.basePrice = basePrice;
                std::string originalPriceText = JsonStringField(object, "org_price");
                best.originalPrice = originalPriceText.empty() ? basePrice : std::stod(originalPriceText);
                best.sku = JsonStringField(object, "sku");
                best.carat = JsonStringField(object, "carat");
                best.id = JsonStringField(object, "id");
            }
        }

        if (page * perPage >= best.totalMatches) break;
    }

    std::remove(bodyFile.c_str());

    if (!std::isfinite(best.lowestPrice)) {
        throw std::runtime_error("no matching diamonds found");
    }

    best.message = "ok";
    return best;
}

int main(int argc, char** argv) {
    std::filesystem::path outputDir = "data";
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--output-dir" && i + 1 < argc) {
            outputDir = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "Usage: LooseGrownDiamondPriceTracker.exe [--output-dir data]\n";
            return 0;
        }
    }

    auto [timestamp, date] = CurrentKstTimestamp();
    Record record;
    record.timestampKst = timestamp;
    record.dateKst = date;
    record.sourceUrl = kPageUrl;

    try {
        PriceResult result = FetchLowestPrice();
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
    } catch (const std::exception& ex) {
        record.status = "error";
        record.message = ex.what();
    }

    const auto csvPath = outputDir / "loosegrown_price_history.csv";
    const auto chartPath = outputDir / "loosegrown_tradingview_chart.html";
    auto records = ReadCsv(csvPath);
    records.push_back(record);
    WriteCsv(csvPath, records);
    WriteTradingViewChartHtml(chartPath, records);

    std::cout << "Saved: " << csvPath.string() << "\n";
    std::cout << "Saved: " << chartPath.string() << "\n";
    std::cout << "Status: " << record.status << " price=" << record.lowestPrice
              << " original=" << record.originalPrice << " discount=" << record.discountPercent << "%\n";

    return record.status == "ok" ? 0 : 1;
}
