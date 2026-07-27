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
    id: 'retirement_admission_deed',
    title: 'Retirement cum Admission Deed',
    subtitle: 'Simultaneous exit of an outgoing partner and admission of a new one',
    governingAct: 'Indian Partnership Act, 1932 (Sections 31 & 32)',
  },
  {
    id: 'dissolution_deed',
    title: 'Dissolution Deed',
    subtitle: 'Dissolution of the partnership firm',
    governingAct: 'Indian Partnership Act, 1932 (Sections 39–55)',
  },
  {
    id: 'rent_agreement',
    title: 'Rent Agreement',
    subtitle: 'Landlord–tenant rent / leave-and-license agreement',
    governingAct: 'Registration Act, 1908 & the applicable State Stamp Act',
  },
  {
    id: 'joint_development_agreement',
    title: 'Joint Development Agreement',
    subtitle: 'Landowner–developer JDA with area / revenue sharing',
    governingAct: 'Transfer of Property Act, 1882; RERA, 2016; Registration Act, 1908',
  },
  {
    id: 'employment_agreement',
    title: 'Employment Agreement',
    subtitle: 'Employer–employee contract with restrictive covenants',
    governingAct: 'Indian Contract Act, 1872 & the applicable Shops and Establishments Act',
  },
  {
    id: 'appointment_letter',
    title: 'Appointment Letter',
    subtitle: 'Formal appointment letter with role, CTC and joining terms',
    governingAct: 'Indian Contract Act, 1872',
  },
];

export function templateById(id: PartnershipDeedTemplateId): DeedTemplateMeta {
  return TEMPLATE_LIST.find((t) => t.id === id) ?? TEMPLATE_LIST[0];
}
