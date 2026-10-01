export class ProviderUnavailableError extends Error {
    providerId;
    reason;
    constructor(providerId, reason) {
        super(reason);
        this.name = 'ProviderUnavailableError';
        this.providerId = providerId;
        this.reason = reason;
    }
}
