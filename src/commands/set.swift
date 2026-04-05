// set.swift — aos set <key> <value>: modify autonomic configuration

import Foundation

func setCommand(args: [String]) {
    guard args.count >= 2 else {
        let config = loadConfig()
        print(jsonString(config))
        return
    }

    let key = args[0]
    let value = args[1]
    setConfigValue(key: key, value: value)
}
