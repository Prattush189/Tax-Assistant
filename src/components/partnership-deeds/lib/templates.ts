import { PartnershipDeedTemplateId } from './uiModel';

export interface DeedTemplateMeta {
  id: PartnershipDeedTemplateId;
  title: string;
  subtitle: string;
  governingAct: string;          // shown to the user and embedded in the AI prompt
}

export const TEMPLATE_LIST: DeedTemplateMeta[] = [
  {
    id: 'partnership_deed',
    title: 'Partnership Deed',
    subtitle: 'Formation of a new partnership firm',
    governingAct: 'Indian Partnership Act, 1932',
  },
  {
    id: 'llp_agreement',
    title: 'LLP Agreement',
    subtitle: 'Limited Liability Partnership formation',
    governingAct: 'Limited Liability Partnership Act, 2008',
  },
  {
    id: 'reconstitution_deed',
    title: 'Reconstitution Deed',
    subtitle: 'Admission of one or more new partners',
    governingAct: 'Indian Partnership Act, 1932 (Sections 31–32)',
  },
  {
    id: 'retirement_deed',
    title: 'Retirement Deed',
    subtitle: 'Exit / retirement of an existing partner',
    governingAct: 'Indian Partnership Act, 1932 (Section 32)',
  },
  {
    id: 'dissolution_deed',
    title: 'Dissolution Deed',
    subtitle: 'Dissolution of the partnership firm',
    governingAct: 'Indian Partnership Act, 1932 (Sections 39–55)',
  },
];

export function templateById(id: PartnershipDeedTemplateId): DeedTemplateMeta {
  return TEMPLATE_LIST.find((t) => t.id === id) ?? TEMPLATE_LIST[0];
}
