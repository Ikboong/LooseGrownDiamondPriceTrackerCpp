#include <iostream>
#include <stdexcept>
#include "../src/loosegrown.h"

int main() {
    try {
        const auto empty = ParseLoosegrownInventory(R"({"total":0,"data":[]})");
        if (empty.at("total") != 0 || !empty.at("data").empty()) throw std::runtime_error("empty inventory misparsed");
        const auto valid = ParseLoosegrownInventory(R"({"total":1,"data":[{"price":"2013"}]})");
        if (valid.at("data").size() != 1) throw std::runtime_error("valid inventory misparsed");
        for (const auto& invalid : {
            R"({"code":"rest_invalid_json","data":{"status":400}})",
            R"({"total":0,"data":{}})", R"({"total":1,"data":[]})",
            R"({"total":0,"data":[{}]})", R"({"total":-1,"data":[]})",
            R"({"total":"0","data":[]})", R"({"total":0.5,"data":[]})", "not json"
        }) {
            bool rejected = false;
            try { ParseLoosegrownInventory(invalid); } catch (const std::exception&) { rejected = true; }
            if (!rejected) throw std::runtime_error("invalid inventory accepted");
        }
        std::cout << "Loose Grown Diamond inventory: 10 checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
