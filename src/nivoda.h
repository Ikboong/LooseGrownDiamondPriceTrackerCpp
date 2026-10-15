#pragma once

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#include "../third_party/nlohmann/json.hpp"

using Json = nlohmann::json;

struct NivodaSource {
    std::string id;
    std::string name;
    std::string origin;
    std::string pageUrl;
    int maxCarats;
    std::vector<std::string> labs;
    bool excellentOnly = false;
};

inline const std::vector<NivodaSource>& NivodaSources() {
    static const std::vector<NivodaSource> sources = {
        {"carbonsparkle", "Carbon Sparkle", "https://www.carbonsparkle.com",
         "https://www.carbonsparkle.com/pages/diamonds?activeTab=Lab+Grown&queryLabGrown=true&isFancy=true&fancy_color=Red%2CPink&carats_min=5&carats_max=50&clarity_min=VVS2&clarity_max=FL&intensity_min=Fancy_Deep&intensity_max=Fancy_Vivid&cut_min=ID&cut_max=ID&shapes=heart",
         50, {"GIA", "IGI", "GCAL", "NONE", "OTHER"}},
        {"aurelinne", "Aurelinne", "https://aurelinne.com",
         "https://aurelinne.com/pages/lab-grown?activeTab=Lab+Grown&queryLabGrown=true&isFancy=true&carats_min=5&carats_max=20&clarity_min=VVS2&clarity_max=FL&fancy_color=Pink%2CRed&intensity_min=Fancy_Deep&intensity_max=Fancy_Vivid&cut_min=ID&cut_max=ID&shapes=heart",
         20, {"GIA", "IGI", "HRD", "WISE"}},
        {"altura", "Altura Diamonds", "https://alturadiamonds.com",
         "https://alturadiamonds.com/collections/lab-diamonds?activeTab=Lab+Grown&queryLabGrown=true&shapes=heart&carats_min=5&carats_max=20&cut_min=ID&cut_max=ID&clarity_min=VVS2&clarity_max=FL&polish=EX&symmetry=EX&isFancy=true&fancy_color=Pink%2CRed&intensity_min=Fancy_Deep&intensity_max=Fancy_Vivid",
         20, {"GIA", "IGI"}, true},
    };
    return sources;
}

inline Json BuildNivodaRequest(const NivodaSource& source, int offset = 0) {
    const std::vector<std::string> grades = source.excellentOnly
        ? std::vector<std::string>{"EX"} : std::vector<std::string>{"GD", "VG", "EX"};
    const std::vector<std::string> colors = source.id == "carbonsparkle"
        ? std::vector<std::string>{"Red", "Pink"} : std::vector<std::string>{"Pink", "Red"};
    return {
        {"showTarrifFreeFeeds", false}, {"callFrom", "feed"}, {"offset", offset},
        {"order", {{"type", "price"}, {"direction", "ASC"}}},
        {"query", {
            {"labgrown", true}, {"shapes", {"HEART"}},
            {"sizes", {{"from", 5}, {"to", source.maxCarats}}},
            {"clarity", {"VVS2", "VVS1", "IF", "FL"}}, {"cut", {"ID"}},
            {"color", {"FANCY"}}, {"fancyColor", colors},
            {"fancyIntensity", {"Fancy_Deep", "Fancy_Vivid"}},
            {"ratio", {{"from", 0.8}, {"to", 3}}},
            {"polish", grades}, {"symmetry", grades},
            {"flouresence", {"NON", "FNT", "MED", "STG", "VST"}},
            {"labgrown_type", Json::array()}, {"certificate_lab", source.labs},
        }},
    };
}

inline double JsonPrice(const Json& value) {
    double number = 0;
    if (value.is_number()) {
        number = value.get<double>();
    } else if (value.is_string()) {
        const auto text = value.get<std::string>();
        size_t used = 0;
        number = std::stod(text, &used);
        if (used != text.size()) throw std::runtime_error("invalid price text");
    } else {
        throw std::runtime_error("missing or invalid price");
    }
    if (!std::isfinite(number) || number <= 0) throw std::runtime_error("price must be positive");
    return number;
}

struct NivodaQuote {
    double price;
    double originalPrice;
    std::string id;
    std::string carat;
};

inline NivodaQuote ParseNivodaQuote(const Json& item, const NivodaSource& source) {
    const auto& certificate = item.at("certificate");
    const auto carats = JsonPrice(certificate.at("carats"));
    const auto color = certificate.at("color").get<std::string>();
    const bool wantedIntensity = color.rfind("Fancy Deep ", 0) == 0 || color.rfind("Fancy Vivid ", 0) == 0;
    const bool wantedColor = wantedIntensity &&
        ((color.size() >= 4 && color.compare(color.size() - 4, 4, "Pink") == 0)
         || (color.size() >= 3 && color.compare(color.size() - 3, 3, "Red") == 0));
    const auto clarity = certificate.at("clarity").get<std::string>();
    const bool wantedClarity = clarity == "VVS2" || clarity == "VVS1" || clarity == "IF" || clarity == "FL";
    const auto lab = certificate.at("lab").get<std::string>();
    const bool wantedLab = std::find(source.labs.begin(), source.labs.end(), lab) != source.labs.end();
    if (!certificate.at("labgrown").get<bool>() || certificate.at("shape") != "HEART"
        || carats < 5 || carats > source.maxCarats || !wantedColor || !wantedClarity || !wantedLab) {
        throw std::runtime_error("inventory API returned a diamond outside the requested filters");
    }
    // Fancy shapes often have no cut grade. The storefront applies cut=ID on
    // its query but still displays these null-cut certificates.
    if (certificate.contains("cut") && !certificate["cut"].is_null() && certificate["cut"] != "ID") {
        throw std::runtime_error("inventory API returned an unexpected cut grade");
    }
    if (item.contains("currency") && item["currency"] != "USD") {
        throw std::runtime_error("inventory API returned a non-USD price");
    }
    const auto original = JsonPrice(item.at("price"));
    const auto discount = item.value("discountedPrice", Json());
    const bool noDiscount = discount.is_null()
        || (discount.is_number() && discount.get<double>() == 0)
        || (discount.is_boolean() && !discount.get<bool>())
        || (discount.is_string() && discount.get<std::string>().empty());
    const auto price = noDiscount ? original : JsonPrice(discount);
    const auto id = item.at("id").get<std::string>();
    if (id.empty()) throw std::runtime_error("inventory API returned an empty diamond id");
    const auto& caratValue = certificate.at("carats");
    return {price, original, id, caratValue.is_string() ? caratValue.get<std::string>() : caratValue.dump()};
}
