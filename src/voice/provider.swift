import Foundation

protocol VoiceProvider {
    var name: String { get }
    var providerRank: Int { get }
    var availability: ProviderAvailability { get }
    func enumerate() -> [VoiceRecord]
}
