#pragma once

#include <stdexcept>
#include <string>

#include "../third_party/nlohmann/json.hpp"

inline nlohmann::json ParseLoosegrownInventory(const std::string& response) {
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
    return page;
}
