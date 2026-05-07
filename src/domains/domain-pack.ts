export interface DomainPackSpec {
  id: string;
  name: string;
  domain: string;
  keywords?: string[];
  planTemplate?: string;
}

export class DomainPack {
  constructor(public spec: DomainPackSpec) {}
}

export class DomainPackRegistry {
  private packs = new Map<string, DomainPackSpec>();
  register(spec: DomainPackSpec) {
    this.packs.set(spec.id, spec);
  }
  list(): DomainPackSpec[] {
    return Array.from(this.packs.values());
  }
}