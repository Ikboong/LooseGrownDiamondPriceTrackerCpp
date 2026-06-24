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
#include <thread>
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
        std::string timestamp;
        std::string date;
        double price;
        double originalPrice;
        std::string sku;
        std::string carat;
        std::string totalMatches;
    };

    std::vector<DailyPoint> points;
    for (const auto& r : records) {
        if (r.status == "ok" && IsNumber(r.lowestPrice)) {
            double original = IsNumber(r.originalPrice) ? std::stod(r.originalPrice) : 0.0;
            DailyPoint point{r.timestampKst, r.dateKst, std::stod(r.lowestPrice), original, r.sku, r.carat, r.totalMatches};
            auto existing = std::find_if(points.begin(), points.end(), [&](const DailyPoint& p) {
                return p.date == point.date;
            });
            if (existing == points.end()) {
                points.push_back(point);
            } else {
                *existing = point;
            }
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
             << "\"timestamp\":\"" << JsonEscape(points[i].timestamp) << "\","
             << "\"value\":" << std::fixed << std::setprecision(0) << points[i].price << ","
             << "\"original\":" << std::fixed << std::setprecision(0) << points[i].originalPrice << ","
             << "\"sku\":\"" << JsonEscape(points[i].sku) << "\","
             << "\"carat\":\"" << JsonEscape(points[i].carat) << "\","
             << "\"totalMatches\":\"" << JsonEscape(points[i].totalMatches) << "\"}";
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
    :root {
      color-scheme: dark;
      --bg: #111418;
      --panel: #1a1f25;
      --panel-border: #2a3037;
      --text: #c9d1d9;
      --muted: #7d8b9a;
      --grid: #242a30;
      --blue: #3f83d8;
      --button: #252b32;
      --button-border: #303842;
    }
    :root.light {
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --panel-border: #d7dde4;
      --text: #1d2630;
      --muted: #667382;
      --grid: #eef1f4;
      --blue: #2f78d1;
      --button: #eef2f6;
      --button-border: #d7dde4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      background: var(--bg);
    }
    main {
      width: min(100vw, 1600px);
      margin: 0 auto;
      padding: 20px 48px 34px;
    }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 24px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 30px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .subtitle, .source {
      color: var(--muted);
      font-size: 18px;
      line-height: 1.35;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
    }
    .source { white-space: nowrap; }
    button {
      border: 1px solid var(--button-border);
      border-radius: 8px;
      background: var(--button);
      color: var(--text);
      cursor: pointer;
      font: inherit;
      height: 45px;
      padding: 0 22px;
    }
    button.active {
      background: var(--blue);
      border-color: var(--blue);
      color: #07111d;
    }
    .tabs {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 15px;
    }
    .chart-shell {
      position: relative;
      height: min(78vh, 850px);
      min-height: 520px;
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    #chart {
      width: 100%;
      height: 100%;
    }
    .tv-mark {
      position: absolute;
      left: 14px;
      bottom: 44px;
      color: #b9c1cc;
      font-size: 29px;
      font-weight: 800;
      letter-spacing: -2px;
      opacity: 0.88;
      pointer-events: none;
    }
    .empty {
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      padding: 28px;
      background: var(--panel);
      color: var(--muted);
    }
    @media (max-width: 760px) {
      main { padding: 18px 14px 28px; }
      header { grid-template-columns: 1fr; gap: 12px; }
      h1 { font-size: 25px; }
      .subtitle, .source { font-size: 14px; }
      .actions { justify-content: flex-start; flex-wrap: wrap; gap: 10px; }
      .source { width: 100%; white-space: normal; }
      .chart-shell { height: 68vh; min-height: 430px; }
      button { height: 42px; padding: 0 14px; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Loose Grown Diamond Charts</h1>
      <div class="subtitle" id="subtitle"></div>
    </div>
    <div class="actions">
      <div class="source">Source: data/loosegrown_price_history.csv</div>
      <button id="themeButton" type="button">Light</button>
    </div>
  </header>
  <div class="tabs" id="tabs" hidden>
    <button class="active" id="dailyButton" type="button">Daily line</button>
    <button id="weeklyButton" type="button">Weekly candle</button>
  </div>
  <div id="content"></div>
</main>
<script>
const dailyData = )html" << data.str() << R"html(;
let activeView = 'daily';
let currentChart = null;
let isLight = false;

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
  const styles = getComputedStyle(document.documentElement);
  return {
    autoSize: true,
    layout: {
      background: { color: styles.getPropertyValue('--panel').trim() },
      textColor: styles.getPropertyValue('--text').trim(),
    },
    grid: {
      vertLines: { color: styles.getPropertyValue('--grid').trim() },
      horzLines: { color: styles.getPropertyValue('--grid').trim() },
    },
    rightPriceScale: { borderColor: styles.getPropertyValue('--panel-border').trim() },
    timeScale: { borderColor: styles.getPropertyValue('--panel-border').trim(), timeVisible: false },
    localization: { priceFormatter: formatPrice },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  };
}

function setActiveButton() {
  document.getElementById('dailyButton').classList.toggle('active', activeView === 'daily');
  document.getElementById('weeklyButton').classList.toggle('active', activeView === 'weekly');
}

function renderChart() {
  const chartElement = document.getElementById('chart');
  chartElement.innerHTML = '';
  if (currentChart && currentChart.remove) currentChart.remove();
  currentChart = LightweightCharts.createChart(chartElement, chartOptions());

  if (activeView === 'daily') {
    const line = currentChart.addLineSeries({
      color: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),
      lineWidth: 2,
      priceLineVisible: true,
    });
    line.setData(dailyData.map(row => ({ time: row.time, value: row.value })));
    } else {
      const candles = currentChart.addCandlestickSeries({
      upColor: '#d44d4d',
      downColor: '#2f78d1',
      borderUpColor: '#d44d4d',
      borderDownColor: '#2f78d1',
      wickUpColor: '#d44d4d',
      wickDownColor: '#2f78d1',
      });
    candles.setData(toWeeklyCandles(dailyData));
  }
  currentChart.timeScale().fitContent();
  setActiveButton();
}

const content = document.getElementById('content');
if (!dailyData.length) {
  content.innerHTML = '<div class="empty">No successful data yet.</div>';
} else {
  const last = dailyData[dailyData.length - 1];
  document.getElementById('subtitle').textContent =
    `Latest: ${last.timestamp} KST / ${formatPrice(last.value)} / ${dailyData.length} daily points`;
  document.getElementById('tabs').hidden = false;
  content.innerHTML = `
    <section class="chart-shell">
      <div id="chart"></div>
      <div class="tv-mark">TV</div>
    </section>`;

  document.getElementById('dailyButton').addEventListener('click', () => {
    activeView = 'daily';
    renderChart();
  });
  document.getElementById('weeklyButton').addEventListener('click', () => {
    activeView = 'weekly';
    renderChart();
  });
  document.getElementById('themeButton').addEventListener('click', () => {
    isLight = !isLight;
    document.documentElement.classList.toggle('light', isLight);
    document.getElementById('themeButton').textContent = isLight ? 'Dark' : 'Light';
    renderChart();
  });
  renderChart();
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

    PriceResult best;
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

            // The colored-diamond inventory API's price field is the value
            // displayed in the search results. Site-wide promo banners can
            // refer to other diamond categories and must not be applied again.
            double displayedPrice = std::stod(basePriceText);
            if (displayedPrice < best.lowestPrice) {
                std::string originalPriceText = JsonStringField(object, "org_price");
                double originalPrice = originalPriceText.empty() ? displayedPrice : std::stod(originalPriceText);

                best.lowestPrice = displayedPrice;
                best.basePrice = displayedPrice;
                best.originalPrice = originalPrice;
                best.discountPercent = originalPrice > displayedPrice
                    ? static_cast<int>(std::lround((1.0 - displayedPrice / originalPrice) * 100.0))
                    : 0;
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
        PriceResult result;
        constexpr int kMaxFetchAttempts = 3;
        for (int attempt = 1; attempt <= kMaxFetchAttempts; ++attempt) {
            try {
                result = FetchLowestPrice();
                break;
            } catch (const std::exception& ex) {
                std::cerr << "Fetch attempt " << attempt << " failed: " << ex.what() << "\n";
                if (attempt == kMaxFetchAttempts) throw;
                std::this_thread::sleep_for(std::chrono::seconds(20));
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
    if (record.status != "ok") {
        std::cout << "Message: " << record.message << "\n";
    }

    return record.status == "ok" ? 0 : 1;
}
