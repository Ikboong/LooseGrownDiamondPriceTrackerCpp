#include <iostream>
#include <stdexcept>
#include "../src/loosegrown.h"

int main() {
    try {
        const auto empty = ParseLoosegrownInventory(R"({"total":0,"data":[]})");
        if (empty.at("total") != 0 || !empty.at("data").empty()) throw std::runtime_error("empty inventory misparsed");
        const auto valid = ParseLoosegrownInventory(R"({"total":1,"data":[{"price":"2013"}]})");
        if (valid.at("data").size() != 1) throw std::runtime_error("valid inventory misparsed");
        const auto legacy = BuildLoosegrownRequest(1, 5);
        const auto combined = BuildLoosegrownRequest(2, 10);
        auto expected = legacy;
        expected["ls_start"] = 2;
        expected["carat_range"] = "10,51.03";
        if (combined != expected || legacy.at("carat_range") != "5,51.03") throw std::runtime_error("legacy and combined request filters mixed");
        if (LoosegrownPageUrl().find("carat=5.00,51.03") == std::string::npos
            || LoosegrownPageUrl(10).find("carat=10.00,51.03") == std::string::npos) throw std::runtime_error("storefront carat URL mismatched");
        for (const auto carat : {"10", "51.03"}) {
            ParseLoosegrownInventory(std::string(R"({"total":1,"data":[{"carat":")") + carat + R"("}]})", 10);
        }
        ParseLoosegrownInventory(R"({"total":1,"data":[{"carat":5.12}]})", 5);
        for (const auto carat : {"9.99", "51.04", "10ct", "nan", ""}) {
            bool rejected = false;
            try { ParseLoosegrownInventory(std::string(R"({"total":1,"data":[{"carat":")") + carat + R"("}]})", 10); }
            catch (const std::exception&) { rejected = true; }
            if (!rejected) throw std::runtime_error("invalid ten-carat inventory accepted");
        }
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
        std::cout << "Loose Grown Diamond inventory and carat boundaries passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
