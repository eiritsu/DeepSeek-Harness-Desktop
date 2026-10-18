/** Live notifications emitted by the shared model catalog. */

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A complete catalog generation was accepted and published.
     * @param payload - The generation consumers should read from `ctx.modelCatalog.facts`.
     * @mode emit
     */
    'model-catalog/updated'(payload: { generation: number }): void
  }
}

export {}
