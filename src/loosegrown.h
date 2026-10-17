#pragma once

#include <stdexcept>
#include <string>
#include <cmath>

#include "../third_party/nlohmann/json.hpp"

inline std::string LoosegrownPageUrl(int minCarats = 5) {
    return "https://www.loosegrowndiamond.com/lab-created-colored-diamonds/"
        "?shape=heart&carat=" + std::to_string(minCarats) + ".00,51.03&certificate=1,2&intensity=4"
        "&cut=3.00,4.00&color=pink&clarity=7.00,11.00";
}

inline nlohmann::json BuildLoosegrownRequest(int page, int minCarats) {
    return {{"ls_start", page}, {"ls_per_page", 50},
        {"carat_range", std::to_string(minCarats) + ",51.03"}, {"cut_range", "3,4"},
        {"colored", "2"}, {"clarity_range", "7,11"}, {"intensity", {4}},
        {"certificate_type", {"1", "2"}}, {"shape", {"heart"}}};
}

inline nlohmann::json ParseLoosegrownInventory(const std::string& response, int minCarats = 0) {
    const auto page = nlohmann::json::parse(response);
    const auto& total = page.at("total");
    const auto& items = page.at("data");
    if (!total.is_number_integer() || !items.is_array()) {
        throw std::runtime_error("invalid Loose Grown Diamond inventory response");
    }
    const auto count = total.get<int>();
    if (count < 0 || count > 5000 || (count == 0 && !items.empty()) || (count > 0 && items.empty())) {
        throw std::runtime_error("incomplete or inconsistent Loose Grown Diamond inventory response");
    }
    if (minCarats > 0) for (const auto& item : items) {
        const auto& value = item.at("carat");
        double carats;
        if (value.is_number()) carats = value.get<double>();
        else if (value.is_string()) {
            const auto text = value.get<std::string>();
            size_t used = 0;
            carats = std::stod(text, &used);
            if (used != text.size()) throw std::runtime_error("invalid Loose Grown Diamond carat");
        } else throw std::runtime_error("missing or invalid Loose Grown Diamond carat");
        if (!std::isfinite(carats) || carats < minCarats || carats > 51.03) {
            throw std::runtime_error("Loose Grown Diamond returned a diamond outside the requested carat range");
        }
    }
    return page;
}
