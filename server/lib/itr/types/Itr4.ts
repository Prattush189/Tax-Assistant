/* eslint-disable */
/**
 * Auto-generated from CBDT ITR JSON schema.
 * Do not edit manually — run `npm run itr:types` instead.
 */

/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "nonEmptyString".
 */
export type NonEmptyString = string;
export type StateCode =
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16'
  | '17'
  | '18'
  | '19'
  | '20'
  | '21'
  | '22'
  | '23'
  | '24'
  | '25'
  | '26'
  | '27'
  | '28'
  | '29'
  | '30'
  | '31'
  | '32'
  | '33'
  | '34'
  | '35'
  | '36'
  | '37'
  | '99';
export type CountryCode =
  | '93'
  | '1001'
  | '355'
  | '213'
  | '684'
  | '376'
  | '244'
  | '1264'
  | '1010'
  | '1268'
  | '54'
  | '374'
  | '297'
  | '61'
  | '43'
  | '994'
  | '1242'
  | '973'
  | '880'
  | '1246'
  | '375'
  | '32'
  | '501'
  | '229'
  | '1441'
  | '975'
  | '591'
  | '1002'
  | '387'
  | '267'
  | '1003'
  | '55'
  | '1014'
  | '673'
  | '359'
  | '226'
  | '257'
  | '238'
  | '855'
  | '237'
  | '1'
  | '1345'
  | '236'
  | '235'
  | '56'
  | '86'
  | '9'
  | '672'
  | '57'
  | '270'
  | '242'
  | '243'
  | '682'
  | '506'
  | '225'
  | '385'
  | '53'
  | '1015'
  | '357'
  | '420'
  | '45'
  | '253'
  | '1767'
  | '1809'
  | '593'
  | '20'
  | '503'
  | '240'
  | '291'
  | '372'
  | '251'
  | '500'
  | '298'
  | '679'
  | '358'
  | '33'
  | '594'
  | '689'
  | '1004'
  | '241'
  | '220'
  | '995'
  | '49'
  | '233'
  | '350'
  | '30'
  | '299'
  | '1473'
  | '590'
  | '1671'
  | '502'
  | '1481'
  | '224'
  | '245'
  | '592'
  | '509'
  | '1005'
  | '6'
  | '504'
  | '852'
  | '36'
  | '354'
  | '91'
  | '62'
  | '98'
  | '964'
  | '353'
  | '1624'
  | '972'
  | '5'
  | '1876'
  | '81'
  | '1534'
  | '962'
  | '7'
  | '254'
  | '686'
  | '850'
  | '82'
  | '965'
  | '996'
  | '856'
  | '371'
  | '961'
  | '266'
  | '231'
  | '218'
  | '423'
  | '370'
  | '352'
  | '853'
  | '389'
  | '261'
  | '265'
  | '60'
  | '960'
  | '223'
  | '356'
  | '692'
  | '596'
  | '222'
  | '230'
  | '269'
  | '52'
  | '691'
  | '373'
  | '377'
  | '976'
  | '382'
  | '1664'
  | '212'
  | '258'
  | '95'
  | '264'
  | '674'
  | '977'
  | '31'
  | '687'
  | '64'
  | '505'
  | '227'
  | '234'
  | '683'
  | '15'
  | '1670'
  | '47'
  | '968'
  | '92'
  | '680'
  | '970'
  | '507'
  | '675'
  | '595'
  | '51'
  | '63'
  | '1011'
  | '48'
  | '14'
  | '1787'
  | '974'
  | '262'
  | '40'
  | '8'
  | '250'
  | '1006'
  | '290'
  | '1869'
  | '1758'
  | '1007'
  | '508'
  | '1784'
  | '685'
  | '378'
  | '239'
  | '966'
  | '221'
  | '381'
  | '248'
  | '232'
  | '65'
  | '1721'
  | '421'
  | '386'
  | '677'
  | '252'
  | '28'
  | '1008'
  | '211'
  | '35'
  | '94'
  | '249'
  | '597'
  | '1012'
  | '268'
  | '46'
  | '41'
  | '963'
  | '886'
  | '992'
  | '255'
  | '66'
  | '670'
  | '228'
  | '690'
  | '676'
  | '1868'
  | '216'
  | '90'
  | '993'
  | '1649'
  | '688'
  | '256'
  | '380'
  | '971'
  | '44'
  | '2'
  | '1009'
  | '598'
  | '998'
  | '678'
  | '58'
  | '84'
  | '1284'
  | '1340'
  | '681'
  | '1013'
  | '967'
  | '260'
  | '263'
  | '9999';
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "nonZeroString".
 */
export type NonZeroString = EndWithDigit;
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "endWithDigit".
 */
export type EndWithDigit = string;

export interface Itr4 {
  ITR?: ITR;
}
/**
 * This is root node, irrespective of Individual or bulk IT returns filed for ITR-4 return JSON.
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ITR".
 */
export interface ITR {
  ITR4: ITR4;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ITR4".
 */
export interface ITR4 {
  CreationInfo: CreationInfo;
  Form_ITR4: Form_ITR4;
  PartA_139_8A?: PartA_139_8A;
  'PartB-ATI'?: PartBATI;
  PersonalInfo: PersonalInfo;
  FilingStatus: FilingStatus;
  IncomeDeductions: IncomeDeductions;
  TaxComputation: TaxComputation;
  TaxPaid: TaxPaid;
  Refund: Refund;
  Schedule80G?: Schedule80G;
  Schedule80GGC?: Schedule80GGC;
  Schedule80DD?: Schedule80DD;
  Schedule80U?: Schedule80U;
  Schedule80E?: Schedule80E;
  Schedule80EE?: Schedule80EE;
  Schedule80EEA?: Schedule80EEA;
  Schedule80EEB?: Schedule80EEB;
  Schedule80C?: Schedule80C;
  ScheduleUs24B?: ScheduleUs24B;
  ScheduleEA10_13A?: ScheduleEA10_13A;
  Schedule80D?: Schedule80D;
  TaxExmpIntIncDtls?: TaxExmpIntIncDtls;
  LTCG112A?: LTCG112A;
  Verification: Verification;
  TaxReturnPreparer?: TaxReturnPreparer;
  ScheduleBP?: ScheduleBP;
  ScheduleIT?: ScheduleIT;
  ScheduleTCS?: ScheduleTCS;
  TDSonSalaries?: TDSonSalaries;
  TDSonOthThanSals?: TDSonOthThanSals;
  ScheduleTDS3Dtls?: ScheduleTDS3Dtls;
}
/**
 * This element will be used by third party vendors and intermediaries to give details of their software or JSON creation.
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "CreationInfo".
 */
export interface CreationInfo {
  SWVersionNo: NonEmptyString;
  SWCreatedBy: NonEmptyString;
  JSONCreatedBy: NonEmptyString;
  /**
   * JSONCreationDate in YYYY-MM-DD format
   */
  JSONCreationDate: string;
  IntermediaryCity: NonEmptyString;
  Digest: NonEmptyString;
}
/**
 * Enter details of IT return form
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Form_ITR4".
 */
export interface Form_ITR4 {
  FormName: NonEmptyString;
  Description: NonEmptyString;
  AssessmentYear: NonEmptyString;
  SchemaVer: NonEmptyString;
  FormVer: NonEmptyString;
}
/**
 * Enter personal information
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "PartA_139_8A".
 */
export interface PartA_139_8A {
  PAN: NonEmptyString;
  Name: NonEmptyString;
  AadhaarCardNo?: NonEmptyString;
  AssessmentYear: NonEmptyString;
  PreviouslyFiledForThisAY: NonEmptyString;
  /**
   * 1 - 139(1); 2 - Other
   */
  PreviouslyFiledForThisAY_139_8A?: NonEmptyString & ('1' | '2');
  Applicable_139_8A?: {
    /**
     * ITR1 - ITR1; ITR2 - ITR2; ITR3 - ITR3; ITR4 - ITR4; ITR5 - ITR5; ITR6 - ITR6; ITR7 - ITR7;
     */
    ITRForm?: NonEmptyString & ('ITR1' | 'ITR2' | 'ITR3' | 'ITR4' | 'ITR5' | 'ITR6' | 'ITR7');
    /**
     * Enter Acknowledgment No. of Original return
     */
    AcknowledgementNo: string;
    /**
     * Enter Date of filing of Original return in YYYY-MM-DD format
     */
    OrigRetFiledDate: string;
  };
  LaidOutIn_139_8A: NonEmptyString;
  /**
   * ITR4 - ITR4
   */
  ITRFormUpdatingInc: NonEmptyString & 'ITR4';
  UpdatingInc?: UpdatingInc;
  /**
   * 1 - Up to 12 months from the end of Relevant Assessment Year; 2 -  Between 12 to 24 Months from the end of Relevant Assessment  Year; 3 - Between 24 to 36 Months from the end of Relevant Assessment Year; 4 - Between 36 to 48 Months from the end of Relevant Assessment Year
   */
  UpdatedReturnDuringPeriod: NonEmptyString & ('1' | '2' | '3' | '4');
  RetrntoRedCarriedFL?: {
    UnabsorbedDepreciation: NonEmptyString;
    UDYear?: UDYear;
  };
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "UpdatingInc".
 */
export interface UpdatingInc {
  ReasonsForUpdatingIncDtls?: {
    /**
     * 1 - Return previously not filed; 2 -  Income not reported correctly; 3 - Wrong heads of income chosen; 4 - Reduction of carried forward loss; 5 - Reduction of unabsorbed depreciation; 6 - Reduction of tax credit u/s 115JB/115JC; 7 - Wrong rate of tax; OTH-Others
     */
    ReasonsForUpdatingIncome: NonEmptyString & ('1' | '2' | '3' | '4' | '5' | '6' | '7' | 'OTH');
  }[];
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "UDYear".
 */
export interface UDYear {
  UnabsorbedDepreciationYearDtls?: {
    /**
     * 2026; 2027
     */
    UnabsorbedDepreciationYear: NonEmptyString & ('2026' | '2027');
    RevisedReturnFile?: NonEmptyString;
    UpdatedReturnFile?: NonEmptyString;
  }[];
}
/**
 * Computation of total updated income and tax payable
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "PartB-ATI".
 */
export interface PartBATI {
  HeadOfInc?: {
    /**
     * Income from Salary
     */
    Salaries?: number;
    /**
     * Income from house property
     */
    IncomeFromHP?: number;
    /**
     * Income from Business or Profession
     */
    IncomeFromBP?: number;
    /**
     * Income from Capital Gains
     */
    IncomeFromCG?: number;
    /**
     * Income from Other Sources
     */
    IncomeFromOS?: number;
    Total?: number;
  };
  LatestTotInc?: number;
  UpdatedTotInc: number;
  AmtPayable: number;
  AmtRefundable?: number;
  LastAmtPayable?: number;
  Refund?: number;
  TotRefund?: number;
  FeeIncUS234F: number;
  RegAssessementTAX?: number;
  AggrLiabilityRefund: number;
  AggrLiabilityNoRefund: number;
  AddtnlIncTax: number;
  NetPayable: number;
  TaxUS140B: number;
  TaxDue10_11: number;
  /**
   * Details of payments of tax on updated return u/s 140B
   */
  ScheduleIT1?: {
    TaxPayment1?: ITTaxPaymentsInfo;
    Total: number;
  };
  /**
   * Details of payments of Advance Tax or Self Assessment Tax or Regular Assessment Tax, credit for which has not been claimed in the earlier return (credit for the same is not to be allowed again under section 140B(2))
   */
  ScheduleIT2?: {
    TaxPayment2?: ITTaxPaymentsInfo;
    Total: number;
  };
  ReleifUS89: number;
}
/**
 * Tax payment detail
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ITTaxPaymentsInfo".
 */
export interface ITTaxPaymentsInfo {
  ITTaxPayments?: {
    slno?: number;
    BSRCode: NonEmptyString;
    /**
     * Date in YYYY-MM-DD format  on or after 2022-04-01
     */
    DateDep: string;
    SrlNoOfChaln: number;
    Amt: number;
  }[];
}
/**
 * Enter personal information
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "PersonalInfo".
 */
export interface PersonalInfo {
  AssesseeName: AssesseeName;
  PAN: NonEmptyString;
  Address: Address;
  /**
   * Date of Birth of the Assessee format YYYY-MM-DD; maximum date allowed 2025-03-31
   */
  DOB: string;
  /**
   * CGOV:Central Government, SGOV:State Government, PSU:Public Sector Undertaking, PE:Pensioners - Central Government, PESG:Pensioners - State Government, PEPS:Pensioners - Public sector undertaking, PEO:Pensioners - Others, OTH:Others, NA:Not Applicable
   */
  EmployerCategory: 'CGOV' | 'SGOV' | 'PSU' | 'PE' | 'PESG' | 'PEPS' | 'PEO' | 'OTH' | 'NA';
  /**
   * I : Individual; H : HUF; F : Firm (other than LLP)
   */
  Status: 'I' | 'H' | 'F';
  AadhaarCardNo?: NonEmptyString;
}
/**
 * Assessee name with Surname mandatory.
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "AssesseeName".
 */
export interface AssesseeName {
  FirstName?: NonEmptyString;
  MiddleName?: NonEmptyString;
  /**
   * Enter Last or Sur name for Individual or HUF or Org name here
   */
  SurNameOrOrgName: NonEmptyString;
}
/**
 * Address of assessee
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Address".
 */
export interface Address {
  ResidenceNo: NonEmptyString;
  ResidenceName?: NonEmptyString;
  RoadOrStreet?: NonEmptyString;
  LocalityOrArea: NonEmptyString;
  CityOrTownOrDistrict: NonEmptyString;
  /**
   * 01-Andaman and Nicobar islands; 02-Andhra Pradesh; 03-Arunachal Pradesh; 04-Assam; 05-Bihar; 06-Chandigarh; 07-Dadra Nagar and Haveli; 08-Daman and Diu; 09- Delhi; 10- Goa; 11-Gujarat; 12- Haryana; 13- Himachal Pradesh; 14-Jammu and Kashmir; 15- Karnataka; 16- Kerala; 17- Lakshadweep; 18-Madhya Pradesh; 19-Maharashtra; 20-Manipur; 21-meghalaya; 22-Mizoram; 23-Nagaland; 24- Odisha; 25- Puducherry; 26- Punjab; 27-Rajasthan; 28- Sikkim; 29-Tamil Nadu; 30- Tripura; 31-Uttar Pradesh; 32- West Bengal; 33- Chhattisgarh; 34- Uttarakhand; 35- Jharkhand; 36- Telangana; 37- Ladakh; 99- Foreign
   *
   * This interface was referenced by `Itr4`'s JSON-Schema
   * via the `definition` "StateCode".
   */
  StateCode: NonEmptyString & StateCode;
  /**
   *  93 : AFGHANISTAN, 1001 : ÅLAND ISLANDS, 355 : ALBANIA, 213 : ALGERIA, 684 : AMERICAN SAMOA, 376 : ANDORRA, 244 : ANGOLA, 1264 : ANGUILLA, 1010 : ANTARCTICA, 1268 : ANTIGUA AND BARBUDA, 54 : ARGENTINA, 374 : ARMENIA, 297 : ARUBA, 61 : AUSTRALIA, 43 : AUSTRIA, 994 : AZERBAIJAN, 1242 : BAHAMAS, 973 : BAHRAIN, 880 : BANGLADESH, 1246 : BARBADOS, 375 : BELARUS, 32 : BELGIUM, 501 : BELIZE, 229 : BENIN, 1441 : BERMUDA, 975 : BHUTAN, 591 : BOLIVIA (PLURINATIONAL STATE OF), 1002 : BONAIRE, SINT EUSTATIUS AND SABA, 387 : BOSNIA AND HERZEGOVINA, 267 : BOTSWANA, 1003 : BOUVET ISLAND, 55 : BRAZIL, 1014 : BRITISH INDIAN OCEAN TERRITORY, 673 : BRUNEI DARUSSALAM, 359 : BULGARIA, 226 :  BURKINA FASO, 257 : BURUNDI, 238 : CABO VERDE, 855 : CAMBODIA, 237 : CAMEROON, 1 : CANADA, 1345 : CAYMAN ISLANDS, 236 : CENTRAL AFRICAN REPUBLIC, 235 : CHAD, 56 : CHILE, 86 : CHINA, 9 : CHRISTMAS ISLAND, 672 : COCOS (KEELING) ISLANDS, 57 : COLOMBIA, 270 : COMOROS, 242 : CONGO, 243 : CONGO (DEMOCRATIC REPUBLIC OF THE), 682 : COOK ISLANDS, 506 : COSTA RICA, 225 : CÔTE D'IVOIRE, 385 : CROATIA, 53 : CUBA, 1015 : CURAÇAO, 357 : CYPRUS, 420 : CZECHIA, 45 : DENMARK, 253 : DJIBOUTI, 1767 : DOMINICA, 1809 : DOMINICAN REPUBLIC, 593 : ECUADOR, 20 : EGYPT, 503 : EL SALVADOR, 240 : EQUATORIAL GUINEA, 291 : ERITREA, 372 : ESTONIA, 251 : ETHIOPIA, 500 : FALKLAND ISLANDS (MALVINAS), 298 : FAROE ISLANDS, 679 : FIJI, 358 : FINLAND, 33 : FRANCE, 594 : FRENCH GUIANA, 689 : FRENCH POLYNESIA, 1004 : FRENCH SOUTHERN TERRITORIES, 241 : GABON, 220 : GAMBIA, 995 : GEORGIA, 49 : GERMANY, 233 : GHANA, 350 : GIBRALTAR, 30 : GREECE, 299 : GREENLAND, 1473 : GRENADA, 590 : GUADELOUPE, 1671 : GUAM, 502 : GUATEMALA, 1481 : GUERNSEY, 224 : GUINEA, 245 : GUINEA-BISSAU, 592 : GUYANA, 509 : HAITI, 1005 : HEARD ISLAND AND MCDONALD ISLANDS, 6 : HOLY SEE, 504 : HONDURAS, 852 : HONG KONG, 36 : HUNGARY, 354 : ICELAND, 91 : INDIA, 62 : INDONESIA, 98 : IRAN (ISLAMIC REPUBLIC OF), 964 : IRAQ, 353 : IRELAND, 1624 : ISLE OF MAN, 972 : ISRAEL, 5 : ITALY, 1876 : JAMAICA, 81 : JAPAN, 1534 : JERSEY, 962 : JORDAN, 7 : KAZAKHSTAN, 254 : KENYA, 686 : KIRIBATI, 850 : KOREA(DEMOCRATIC PEOPLE'S REPUBLIC OF), 82 : KOREA (REPUBLIC OF), 965 : KUWAIT, 996 : KYRGYZSTAN, 856 : LAO PEOPLE'S DEMOCRATIC REPUBLIC, 371 : LATVIA, 961 : LEBANON, 266 : LESOTHO, 231 : LIBERIA, 218 : LIBYA, 423 : LIECHTENSTEIN, 370 : LITHUANIA, 352 : LUXEMBOURG, 853 : MACAO, 389 : MACEDONIA(THE FORMER YUGOSLAV REPUBLIC OF), 261 : MADAGASCAR, 265 : MALAWI, 60 : MALAYSIA, 960 : MALDIVES, 223 : MALI, 356 : MALTA, 692 : MARSHALL ISLANDS, 596 : MARTINIQUE, 222 : MAURITANIA, 230 : MAURITIUS, 269 : MAYOTTE, 52 : MEXICO, 691 : MICRONESIA (FEDERATED STATES OF), 373 : MOLDOVA (REPUBLIC OF), 377 : MONACO, 976 : MONGOLIA, 382 : MONTENEGRO, 1664 : MONTSERRAT, 212 : MOROCCO, 258 : MOZAMBIQUE, 95 : MYANMAR, 264 : NAMIBIA, 674 : NAURU, 977 : NEPAL, 31 : NETHERLANDS, 687 : NEW CALEDONIA, 64 : NEW ZEALAND, 505 : NICARAGUA, 227 : NIGER, 234 : NIGERIA, 683 : NIUE, 15 : NORFOLK ISLAND, 1670 : NORTHERN MARIANA ISLANDS, 47 : NORWAY, 968 : OMAN, 92 : PAKISTAN, 680 : PALAU, 970 : PALESTINE, STATE OF, 507 : PANAMA, 675 : PAPUA NEW GUINEA, 595 : PARAGUAY, 51 : PERU, 63 : PHILIPPINES, 1011 : PITCAIRN, 48 : POLAND, 14 : PORTUGAL, 1787 : PUERTO RICO, 974 : QATAR, 262 : RÉUNION, 40 : ROMANIA, 8 : RUSSIAN FEDERATION, 250 : RWANDA, 1006 : SAINT BARTHÉLEMY, 290 :  SAINT HELENA, ASCENSION AND TRISTAN DA CUNHA, 1869 : SAINT KITTS AND NEVIS, 1758 : SAINT LUCIA, 1007 : SAINT MARTIN (FRENCH PART), 508 : SAINT PIERRE AND MIQUELON, 1784 : SAINT VINCENT AND THE GRENADINES, 685 : SAMOA, 378 : SAN MARINO, 239 : SAO TOME AND PRINCIPE, 966 : SAUDI ARABIA, 221 : SENEGAL, 381 : SERBIA, 248 : SEYCHELLES, 232 : SIERRA LEONE, 65 : SINGAPORE, 1721 : SINT MAARTEN (DUTCH PART), 421 : SLOVAKIA, 386 : SLOVENIA, 677 : SOLOMON ISLANDS, 252 : SOMALIA, 28 : SOUTH AFRICA, 1008 : SOUTH GEORGIA AND THE SOUTH SANDWICH ISLANDS, 211 : SOUTH SUDAN, 35 : SPAIN, 94 : SRI LANKA, 249 : SUDAN, 597 : SURINAME, 1012 : SVALBARD AND JAN MAYEN, 268 : SWAZILAND, 46 : SWEDEN, 41 : SWITZERLAND, 963 : SYRIAN ARAB REPUBLIC, 886 : TAIWAN, 992 : TAJIKISTAN, 255 : TANZANIA, UNITED REPUBLIC OF, 66 : THAILAND, 670 : TIMOR-LESTE (EAST TIMOR), 228 : TOGO, 690 : TOKELAU, 676 : TONGA, 1868 : TRINIDAD AND TOBAGO, 216 : TUNISIA, 90 : TURKEY, 993 : TURKMENISTAN, 1649 : TURKS AND CAICOS ISLANDS, 688 : TUVALU, 256 : UGANDA, 380 : UKRAINE, 971 : UNITED ARAB EMIRATES, 44 : UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND, 2 : UNITED STATES OF AMERICA, 1009 : UNITED STATES MINOR OUTLYING ISLANDS, 598 : URUGUAY, 998 : UZBEKISTAN, 678 : VANUATU, 58 : VENEZUELA (BOLIVARIAN REPUBLIC OF), 84 : VIET NAM, 1284 : VIRGIN ISLANDS (BRITISH), 1340 : VIRGIN ISLANDS (U.S.), 681 : WALLIS AND FUTUNA, 1013 : WESTERN SAHARA, 967 : YEMEN, 260 : ZAMBIA, 263 : ZIMBABWE, 9999 : OTHERS
   *
   * This interface was referenced by `Itr4`'s JSON-Schema
   * via the `definition` "CountryCode".
   */
  CountryCode: NonEmptyString & CountryCode;
  PinCode?: number;
  ZipCode?: string;
  Phone?: {
    STDcode: number;
    PhoneNo: string;
  };
  CountryCodeMobile: number;
  MobileNo: number;
  CountryCodeMobileNoSec?: number;
  MobileNoSec?: number;
  /**
   * Email Id is required for receiving copy of ITR-V
   */
  EmailAddress: NonEmptyString;
  /**
   * Alternate Email Id
   */
  EmailAddressSec?: NonEmptyString;
}
/**
 * Filing status of assesse
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "FilingStatus".
 */
export interface FilingStatus {
  /**
   * 11 : 139(1)-On or before due date; 12 : 139(4)-After due date; 13 : 142(1); 14 : 148; 16 : 153C, 17 : 139(5)-Revised Return; 18 : 139(9); 20 : 119(2)(b) - After condonation of delay; 21 : 139(8A)-Updated Return
   */
  ReturnFileSec: 11 | 12 | 13 | 14 | 16 | 17 | 18 | 20 | 21;
  /**
   * Y : Yes, N : No, NA : Not applicable
   */
  OptOutNewTaxRegime_Form10IEA_AY24_25: 'Y' | 'N' | 'NA';
  /**
   * Form 10IEA filing date in YYYY-MM-DD format
   */
  Form10IEADate_AY24_25?: string;
  Form10IEAAckNo_AY24_25?: number;
  /**
   * Y : Yes, N : No
   */
  Yes_ContOptOutNewTaxReg?: 'Y' | 'N';
  /**
   * Y : Yes, N : No
   */
  No_OptOutNewTaxReg?: 'Y' | 'N';
  /**
   * Y : Yes, N : No
   */
  NA_OptOutNewTaxReg?: 'Y' | 'N';
  /**
   * Form 10IEA filing date in YYYY-MM-DD format
   */
  Form10IEADate?: string;
  Form10IEAAckNo?: number;
  SeventhProvisio139?: NonEmptyString;
  DepAmtAggAmtExcd1CrPrYrFlg?: NonEmptyString;
  AmtSeventhProvisio139i?: number;
  IncrExpAggAmt2LkTrvFrgnCntryFlg?: NonEmptyString;
  AmtSeventhProvisio139ii?: number;
  IncrExpAggAmt1LkElctrctyPrYrFlg?: NonEmptyString;
  AmtSeventhProvisio139iii?: number;
  clauseiv7provisio139i?: NonEmptyString;
  clauseiv7provisio139iDtls?: Clauseiv7Provisio139IType[];
  /**
   * Enter the Receipt number of the; original return.
   */
  ReceiptNo?: string;
  NoticeNo?: NonEmptyString;
  /**
   * Enter Date of filing of Original return in YYYY-MM-DD format
   */
  OrigRetFiledDate?: string;
  /**
   * Date of Order or Notice in YYYY-MM-DD format
   */
  NoticeDateUnderSec?: string;
  /**
   * Y - Yes; N - No
   */
  AsseseeRepFlg: NonEmptyString & ('Y' | 'N');
  AssesseeRep?: AssesseeRep;
  ItrFilingDueDate: NonEmptyString;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "clauseiv7provisio139iType".
 */
export interface Clauseiv7Provisio139IType {
  /**
   * 1 -  The total sales, turnover or gross receipts, as the case may be, of the person in the business exceeds sixty lakh rupees during the previous year; 2 -  The total gross receipts of the person in profession exceeds ten lakh rupees during the previous year; 3 - The aggregate of tax deducted at source and tax collected at source during the previous year, in the case of the person, is twenty-five thousand rupees or more(fifty thousand for resident senior citizen); 4 - The deposit in one or more savings bank account of the person, in aggregate, is fifty lakh rupees or more, in the previous year
   */
  clauseiv7provisio139iNature: '1' | '2' | '3' | '4';
  clauseiv7provisio139iAmount: number;
}
/**
 * Assessee representative
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "AssesseeRep".
 */
export interface AssesseeRep {
  RepName: NonEmptyString;
  /**
   * L - Legal Heir; M - Manager; G - Guardian; O - Other
   */
  RepCapacity: NonEmptyString & ('L' | 'M' | 'G' | 'O');
  RepAddress: NonEmptyString;
  RepPAN: NonEmptyString;
  RepAadhaar?: NonEmptyString;
}
/**
 * Income and deduction details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "IncomeDeductions".
 */
export interface IncomeDeductions {
  IncomeFromBusinessProf: number;
  GrossSalary: number;
  Salary?: number;
  PerquisitesValue?: number;
  ProfitsInSalary?: number;
  IncomeNotified89A: number;
  IncomeNotified89AType?: NOT89AType[];
  IncomeNotifiedOther89A?: number;
  AllwncExemptUs10?: {
    AllwncExemptUs10Dtls?: {
      /**
       * 10(5) - Sec 10(5)-Leave Travel concession/assistance; 10(6) - Sec 10(6)-Remuneration received as an official, by whatever name called, of an embassy, high commission etc.; 10(7) - Sec 10(7)-Allowances or perquisites paid or allowed as such outside India by the Government to a citizen of India for rendering service outside India; 10(10) - Sec 10(10)-Death-cum-retirement gratuity received ; 10(10A) - Sec 10(10A)-Commuted value of pension received; 10(10AA) - Sec 10(10AA)-Earned leave encashment on Retirement; 10(10B)(i) - Sec 10(10B)-First proviso - Compensation limit notified by CG in the Official Gazette; 10(10B)(ii) - Sec 10(10B)-Second proviso - Compensation under scheme approved by the Central Government; 10(10C) - Sec 10(10C)- Amount received/receivable on voluntary retirement or termination of service; 10(10CC) - Sec 10(10CC)-Tax paid by employer on non-monetary perquisite; 10(13A) - Sec 10(13A)-Allowance to meet expenditure incurred on house rent; 10(14)(i) - Sec 10(14)(i)- Prescribed Allowances or benefits (not in a nature of perquisite) specifically granted to meet expenses wholly, necessarily and exclusively and to the extent actually incurred, in performance of duties of office or employment; 10(14)(ii) - Sec 10(14)(ii) -Prescribed Allowances or benefits granted to meet personal expenses in performance of duties of office or employment or to compensate him for increased cost of living. ; 10(14)(i)(115BAC) - Sec 10(14)(i) -Allowances referred in sub-clauses (a) to (c) of sub-rule (1) in Rule 2BB ; 10(14)(ii)(115BAC) - Sec 10(14)(ii) -Transport allowance granted to certain physically handicapped assessee ; EIC - Exempt income received by a judge covered under the payment of salaries to Supreme Court/High Court judges Act /Rules ; OTH - Any Other
       */
      SalNatureDesc: NonEmptyString &
        (
          | '10(5)'
          | '10(6)'
          | '10(7)'
          | '10(10)'
          | '10(10A)'
          | '10(10AA)'
          | '10(10B)(i)'
          | '10(10B)(ii)'
          | '10(10C)'
          | '10(10CC)'
          | '10(13A)'
          | '10(14)(i)'
          | '10(14)(ii)'
          | '10(14)(i)(115BAC)'
          | '10(14)(ii)(115BAC)'
          | 'EIC'
          | 'OTH'
        );
      SalOthNatOfInc?: NonEmptyString;
      SalOthAmount: number;
    }[];
    TotalAllwncExemptUs10: number;
  };
  Increliefus89A?: number;
  NetSalary: number;
  DeductionUs16: number;
  DeductionUs16ia?: number;
  EntertainmntalwncUs16ii?: number;
  ProfessionalTaxUs16iii?: number;
  IncomeFromSal: number;
  /**
   * S:Self Occupied; L:Let Out; D:Deemed let out
   */
  TypeOfHP?: NonEmptyString;
  GrossRentReceived?: number;
  TaxPaidlocalAuth?: number;
  AnnualValue: number;
  AnnualValue30Percent: number;
  InterestPayable?: number;
  ArrearsUnrealizedRentRcvd?: number;
  /**
   * House Property income
   */
  TotalIncomeOfHP: number;
  IncomeOthSrc: number;
  OthersInc?: {
    OthersIncDtlsOthSrc?: {
      /**
       * SAV : Interest from Saving Account; IFD : Interest from Deposit(Bank/Post Office/Cooperative Society); TAX : Interest from Income Tax Refund; FAP : Family pension; DIV : Dividend; 10(11)(iP) : Interest accrued on contributions to provident fund to the extent taxable as per first proviso to section 10(11); 10(11)(iiP) : Interest accrued on contributions to provident fund to the extent taxable as per second proviso to section 10(11); 10(12)(iP) : Interest accrued on contributions to provident fund to the extent taxable as per first proviso to section 10(12); 10(12)(iiP) : Interest accrued on contributions to provident fund to the extent taxable as per second proviso to section 10(12); NOT89A : Income from retirement benefit account maintained in a notified country u/s 89A ; OTHNOT89A : Income from retirement benefit account maintained in a country other than a country notified u/s 89A ; OTH : Any Other
       */
      OthSrcNatureDesc: NonEmptyString &
        (
          | 'SAV'
          | 'IFD'
          | 'TAX'
          | 'FAP'
          | 'DIV'
          | '10(11)(iP)'
          | '10(11)(iiP)'
          | '10(12)(iP)'
          | '10(12)(iiP)'
          | 'NOT89A'
          | 'OTHNOT89A'
          | 'OTH'
        );
      NOT89A?: NOT89AType[];
      OthSrcOthNatOfInc?: NonEmptyString;
      OthSrcOthAmount: number;
      DividendInc?: DateRangeType;
      NOT89AInc?: DateRangeType;
    }[];
  };
  DeductionUs57iia?: number;
  Increliefus89AOS?: number;
  /**
   * Gross Total Income without LTCG u/s 112A
   */
  GrossTotIncome: number;
  /**
   * Gross Total Income including LTCG u/s 112A
   */
  GrossTotIncomeIncLTCG112A: number;
  UsrDeductUndChapVIA: UsrDeductUndChapVIAType;
  DeductUndChapVIA: DeductUndChapVIAType;
  TotalIncome: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "NOT89AType".
 */
export interface NOT89AType {
  /**
   * US - United States; UK - United Kingdom; CA - Canada
   */
  NOT89ACountrycode: 'US' | 'UK' | 'CA';
  NOT89AAmount: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "DateRangeType".
 */
export interface DateRangeType {
  DateRange: {
    Upto15Of6: number;
    Upto15Of9: number;
    Up16Of9To15Of12: number;
    Up16Of12To15Of3: number;
    Up16Of3To31Of3: number;
  };
}
/**
 * Deductions from income
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "UsrDeductUndChapVIAType".
 */
export interface UsrDeductUndChapVIAType {
  Section80C: number;
  Section80CCC: number;
  /**
   * For Employee/SelfEmployed
   */
  Section80CCDEmployeeOrSE: number;
  Section80CCD1B: number;
  Section80CCDEmployer: number;
  PRANNum?: string;
  Section80D: number;
  Section80DD: number;
  /**
   * 1 : Self or dependent , 2 : Self or dependent - Senior Citizen
   */
  Section80DDBUsrType?: NonEmptyString & ('1' | '2');
  /**
   * a : Dementia; b : Dystonia Musculorum Deformans; c : Motor Neuron Disease; d : Ataxia; e : Chorea; f : Hemiballismus; g : Aphasia; h: Parkinsons Disease; i : Malignant Cancers; j : Full Blown Acquired Immuno-Deficiency Syndrome (AIDS); k:Chronic Renal failure; l:Hematological disorders; m: Hemophilia; n:Thalassaemia
   */
  NameOfSpecDisease80DDB?: NonEmptyString &
    ('a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n');
  Section80DDB: number;
  Section80E: number;
  Section80EE?: number;
  Section80EEA?: number;
  Section80EEB?: number;
  Section80G: number;
  Section80GG: number;
  Form10BAAckNum?: string;
  Section80GGC: number;
  Section80U: number;
  Section80TTA: number;
  Section80TTB: number;
  AnyOthSec80CCH: number;
  TotalChapVIADeductions: number;
}
/**
 * Deductions from income
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "DeductUndChapVIAType".
 */
export interface DeductUndChapVIAType {
  Section80C: number;
  Section80CCC: number;
  /**
   * For Employee/SelfEmployed
   */
  Section80CCDEmployeeOrSE: number;
  Section80CCD1B: number;
  Section80CCDEmployer: number;
  Section80D: number;
  Section80DD: number;
  Section80DDB: number;
  Section80E: number;
  Section80EE?: number;
  Section80EEA?: number;
  Section80EEB?: number;
  Section80G: number;
  Section80GG: number;
  Section80GGC: number;
  Section80U: number;
  Section80TTA: number;
  Section80TTB: number;
  AnyOthSec80CCH: number;
  TotalChapVIADeductions: number;
}
/**
 * Tax computation details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TaxComputation".
 */
export interface TaxComputation {
  TotalTaxPayable: number;
  Rebate87A: number;
  TaxPayableOnRebate: number;
  EducationCess: number;
  GrossTaxLiability: number;
  Section89?: number;
  /**
   * Balance Tax After Relief
   */
  NetTaxLiability: number;
  IntrstPay: IntrstPay;
  TotTaxPlusIntrstPay: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "IntrstPay".
 */
export interface IntrstPay {
  IntrstPayUs234A: number;
  IntrstPayUs234B: number;
  IntrstPayUs234C: number;
  LateFilingFee234F: number;
}
/**
 * Tax paid details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TaxPaid".
 */
export interface TaxPaid {
  TaxesPaid: TaxesPaid;
  BalTaxPayable: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TaxesPaid".
 */
export interface TaxesPaid {
  AdvanceTax: number;
  TDS: number;
  /**
   * Required for ITR4
   */
  TCS: number;
  SelfAssessmentTax: number;
  TotalTaxesPaid: number;
}
/**
 * Refund details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Refund".
 */
export interface Refund {
  /**
   * Refund due if Total Taxes Paid is greater than AggregateTaxInterest
   */
  RefundDue: number;
  BankAccountDtls: BankAccountDtls;
}
/**
 * Bank details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "BankAccountDtls".
 */
export interface BankAccountDtls {
  /**
   * @minItems 1
   */
  AddtnlBankDetails?: [BankDetailType, ...BankDetailType[]];
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "BankDetailType".
 */
export interface BankDetailType {
  IFSCCode: NonEmptyString;
  BankName: NonEmptyString;
  BankAccountNo: NonZeroString;
  /**
   * SB: Savings Account, CA: Current Account,CC: Cash Credit Account, OD: Over draft account, NRO: Non Resident Account, OTH: Other
   */
  AccountType: 'SB' | 'CA' | 'CC' | 'OD' | 'NRO' | 'OTH';
  UseForRefund: NonEmptyString & ('true' | 'false');
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80G".
 */
export interface Schedule80G {
  Don100Percent?: {
    /**
     * @minItems 1
     */
    DoneeWithPan?: [DoneeWithPan, ...DoneeWithPan[]];
    TotDon100PercentCash: number;
    TotDon100PercentOtherMode: number;
    TotDon100Percent: number;
    TotEligibleDon100Percent: number;
  };
  Don50PercentNoApprReqd?: {
    /**
     * @minItems 1
     */
    DoneeWithPan?: [DoneeWithPan, ...DoneeWithPan[]];
    TotDon50PercentNoApprReqdCash: number;
    TotDon50PercentNoApprReqdOtherMode: number;
    TotDon50PercentNoApprReqd: number;
    TotEligibleDon50Percent: number;
  };
  Don100PercentApprReqd?: {
    /**
     * @minItems 1
     */
    DoneeWithPan?: [DoneeWithPan, ...DoneeWithPan[]];
    TotDon100PercentApprReqdCash: number;
    TotDon100PercentApprReqdOtherMode: number;
    TotDon100PercentApprReqd: number;
    TotEligibleDon100PercentApprReqd: number;
  };
  Don50PercentApprReqd?: {
    /**
     * @minItems 1
     */
    DoneeWithPan?: [DoneeWithPan, ...DoneeWithPan[]];
    TotDon50PercentApprReqdCash: number;
    TotDon50PercentApprReqdOtherMode: number;
    TotDon50PercentApprReqd: number;
    TotEligibleDon50PercentApprReqd: number;
  };
  TotalDonationsUs80GCash: number;
  TotalDonationsUs80GOtherMode: number;
  TotalDonationsUs80G: number;
  TotalEligibleDonationsUs80G: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "DoneeWithPan".
 */
export interface DoneeWithPan {
  DoneeWithPanName: NonEmptyString;
  /**
   * Please enter ARN (Donation reference Number)
   */
  ArnNbr?: NonEmptyString;
  DoneePAN: NonEmptyString;
  AddressDetail: AddressDetail80G;
  DonationAmtCash?: number;
  DonationAmtOtherMode?: number;
  DonationAmt: number;
  EligibleDonationAmt: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "AddressDetail80G".
 */
export interface AddressDetail80G {
  AddrDetail: NonEmptyString;
  CityOrTownOrDistrict: NonEmptyString;
  /**
   * 01-Andaman and Nicobar islands, 02-Andhra Pradesh, 03-Arunachal Pradesh, 04-Assam, 05-Bihar, 06-Chandigarh, 07-Dadra Nagar and Haveli, 08-Daman and Diu, 09- Delhi, 10- Goa, 11-Gujarat, 12- Haryana, 13- Himachal Pradesh, 14-Jammu and Kashmir, 15- Karnataka, 16- Kerala, 17- Lakshadweep, 18-Madhya Pradesh, 19-Maharashtra, 20-Manipur, 21-Meghalaya, 22-Mizoram, 23-Nagaland, 24- Odisha, 25- Puducherry, 26- Punjab, 27-Rajasthan, 28- Sikkim, 29-Tamil Nadu, 30- Tripura, 31-Uttar Pradesh, 32- West Bengal, 33- Chhattisgarh, 34- Uttarakhand, 35- Jharkhand, 36- Telangana, 37- Ladakh
   */
  StateCode: NonEmptyString &
    (
      | '01'
      | '02'
      | '03'
      | '04'
      | '05'
      | '06'
      | '07'
      | '08'
      | '09'
      | '10'
      | '11'
      | '12'
      | '13'
      | '14'
      | '15'
      | '16'
      | '17'
      | '18'
      | '19'
      | '20'
      | '21'
      | '22'
      | '23'
      | '24'
      | '25'
      | '26'
      | '27'
      | '28'
      | '29'
      | '30'
      | '31'
      | '32'
      | '33'
      | '34'
      | '35'
      | '36'
      | '37'
    );
  PinCode: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80GGC".
 */
export interface Schedule80GGC {
  Schedule80GGCDetails?: {
    /**
     * Date of Donation in YYYY-MM-DD format
     */
    DonationDate: string;
    DonationAmtCash: number;
    DonationAmtOtherMode: number;
    TransactionRefNum?: string;
    IFSCCode?: NonEmptyString;
    DonationAmt: number;
    EligibleDonationAmt: number;
  }[];
  TotalDonationAmtCash80GGC: number;
  TotalDonationAmtOtherMode80GGC: number;
  TotalDonationsUs80GGC: number;
  TotalEligibleDonationAmt80GGC: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80DD".
 */
export interface Schedule80DD {
  /**
   * 1 : Dependent person with disability  ; 2 : Dependent person with severe disability
   */
  NatureOfDisability: NonEmptyString & ('1' | '2');
  /**
   * 1 : autism, cerebral palsy, or multiple disabilities ; 2 : others;
   */
  TypeOfDisability: NonEmptyString & ('1' | '2');
  DeductionAmount: number;
  /**
   * 1. Spouse; 2. Son; 3. Daughter; 4. Father; 5. Mother; 6. Brother; 7. Sister; 8. Member of the HUF (in case of HUF)
   */
  DependentType: NonEmptyString & ('1' | '2' | '3' | '4' | '5' | '6' | '7' | '8');
  DependentPan?: NonEmptyString;
  DependentAadhaar?: NonEmptyString;
  Form10IAAckNum?: string;
  UDIDNum?: string;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80U".
 */
export interface Schedule80U {
  /**
   * 1 : Self with disability  ; 2 : Self with severe disability
   */
  NatureOfDisability: NonEmptyString & ('1' | '2');
  /**
   * 1 : autism, cerebral palsy, or multiple disabilities ; 2 : others;
   */
  TypeOfDisability: NonEmptyString & ('1' | '2');
  DeductionAmount: number;
  Form10IAAckNum?: string;
  UDIDNum?: string;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80E".
 */
export interface Schedule80E {
  Schedule80EDtls: {
    /**
     * B: Bank, I: Institution
     */
    LoanTknFrom: 'B' | 'I';
    BankOrInstnName: NonEmptyString;
    LoanAccNoOfBankOrInstnRefNo: NonZeroString;
    /**
     * Date in YYYY-MM-DD format
     */
    DateofLoan: string;
    TotalLoanAmt: number;
    LoanOutstndngAmt: number;
    Interest80E: number;
  }[];
  TotalInterest80E: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80EE".
 */
export interface Schedule80EE {
  Schedule80EEDtls: {
    /**
     * B: Bank, I: Institution
     */
    LoanTknFrom: 'B' | 'I';
    BankOrInstnName: NonEmptyString;
    LoanAccNoOfBankOrInstnRefNo: NonZeroString;
    /**
     * Date in YYYY-MM-DD format
     */
    DateofLoan: string;
    TotalLoanAmt: number;
    LoanOutstndngAmt: number;
    Interest80EE: number;
  }[];
  TotalInterest80EE: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80EEA".
 */
export interface Schedule80EEA {
  PropStmpDtyVal: number;
  Schedule80EEADtls: {
    /**
     * B: Bank, I: Institution
     */
    LoanTknFrom: 'B' | 'I';
    BankOrInstnName: NonEmptyString;
    LoanAccNoOfBankOrInstnRefNo: NonZeroString;
    /**
     * Date in YYYY-MM-DD format
     */
    DateofLoan: string;
    TotalLoanAmt: number;
    LoanOutstndngAmt: number;
    Interest80EEA: number;
  }[];
  TotalInterest80EEA: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80EEB".
 */
export interface Schedule80EEB {
  Schedule80EEBDtls: {
    /**
     * B: Bank, I: Institution
     */
    LoanTknFrom: 'B' | 'I';
    BankOrInstnName: NonEmptyString;
    LoanAccNoOfBankOrInstnRefNo: NonZeroString;
    /**
     * Date in YYYY-MM-DD format
     */
    DateofLoan: string;
    TotalLoanAmt: number;
    LoanOutstndngAmt: number;
    VehicleRegNo: NonEmptyString;
    Interest80EEB: number;
  }[];
  TotalInterest80EEB: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80C".
 */
export interface Schedule80C {
  Schedule80CDtls: {
    Amount: number;
    IdentificationNo: string;
  }[];
  TotalAmt: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ScheduleUs24B".
 */
export interface ScheduleUs24B {
  ScheduleUs24BDtls: {
    /**
     * B: Bank, I: Other than Bank
     */
    LoanTknFrom: 'B' | 'I';
    BankOrInstnName: NonEmptyString;
    LoanAccNoOfBankOrInstnRefNo: NonZeroString;
    /**
     * Date in YYYY-MM-DD format
     */
    DateofLoan: string;
    TotalLoanAmt: number;
    LoanOutstndngAmt: number;
    InterestUs24B: number;
  }[];
  TotalInterestUs24B: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ScheduleEA10_13A".
 */
export interface ScheduleEA10_13A {
  /**
   * 1: Metro, 2: Non-Metro
   */
  Placeofwork: '1' | '2';
  ActlHRARecv: number;
  ActlRentPaid: number;
  DtlsSalUsSec171: number;
  BasicSalary: number;
  DearnessAllwnc?: number;
  ActlRentPaid10Per: number;
  Sal40Or50Per: number;
  EligbleExmpAllwncUs13A: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Schedule80D".
 */
export interface Schedule80D {
  Sec80DSelfFamSrCtznHealth: {
    /**
     * Y - Yes; N - No; S - Not claiming for Self/ Family
     */
    SeniorCitizenFlag?: NonEmptyString;
    SelfAndFamily?: number;
    HealthInsPremSlfFam?: number;
    Sec80DSelfFamHIDtls?: {
      Sch80DInsDtls: Sch80DInsDtls[];
      TotalPayments: number;
    };
    PrevHlthChckUpSlfFam?: number;
    SelfAndFamilySeniorCitizen?: number;
    HlthInsPremSlfFamSrCtzn?: number;
    Sec80DSelfFamSrCtznHIDtls?: {
      Sch80DInsDtls: Sch80DInsDtls[];
      TotalPayments: number;
    };
    PrevHlthChckUpSlfFamSrCtzn?: number;
    MedicalExpSlfFamSrCtzn?: number;
    /**
     * Y - Yes; N - No; P - Not claiming for Parents
     */
    ParentsSeniorCitizenFlag?: NonEmptyString;
    Parents?: number;
    HlthInsPremParents?: number;
    Sec80DParentsHIDtls?: {
      Sch80DInsDtls: Sch80DInsDtls[];
      TotalPayments: number;
    };
    PrevHlthChckUpParents?: number;
    ParentsSeniorCitizen?: number;
    HlthInsPremParentsSrCtzn?: number;
    Sec80DParentsSrCtznHIDtls?: {
      Sch80DInsDtls: Sch80DInsDtls[];
      TotalPayments: number;
    };
    PrevHlthChckUpParentsSrCtzn?: number;
    MedicalExpParentsSrCtzn?: number;
    EligibleAmountOfDedn: number;
  };
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Sch80DInsDtls".
 */
export interface Sch80DInsDtls {
  InsurerName: string;
  PolicyNo: string;
  HealthInsAmt: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TaxExmpIntIncDtls".
 */
export interface TaxExmpIntIncDtls {
  OthersInc?: {
    OthersIncDtls?: ExemptUs10[];
    OthersTotalTaxExe: number;
  };
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ExemptUs10".
 */
export interface ExemptUs10 {
  /**
   * AGRI : Agriculture Income (<= Rs.5000); 10(10BC): Sec 10(10BC)-Any amount from the Central/State Govt./local authority by way of compensation on account of any disaster; 10(10D) : Sec 10(10D)- Any sum received under a life insurance policy, including the sum allocated by way of bonus on such policy except sum as mentioned in sub-clause (a) to (d) of Sec.10(10D); 10(11) : Sec 10(11)-Statuory Provident Fund received; 10(12) : Sec 10(12)-Recognised Provident Fund received; 10(12C) : Sec 10(12C)-Any payment from the Agniveer Corpus Fund to a person enrolled under the Agnipath Scheme, or to his nominee.; 10(13) : Sec 10(13)-Approved superannuation fund received; 10(16) : Sec 10(16)-Scholarships granted to meet the cost of education; 10(17) : Sec 10(17)-Allownace MP/MLA/MLC; 10(17A) : Sec 10(17A)-Award instituted by Government; 10(18) : Sec 10(18)-Pension received by winner of "Param Vir Chakra" or "Maha Vir Chakra" or "Vir Chakra" or such other gallantry award; DMDP : Defense medical disability pension; 10(19) : Sec 10(19)-Armed Forces Family pension in case of death during operational duty; 10(26) : Sec 10(26)-Any income as referred to in section 10(26); 10(26AAA): Sec 10(26AAA)-Any income as referred to in section 10(26AAA); OTH : Any Other
   */
  NatureDesc: NonEmptyString &
    (
      | 'AGRI'
      | '10(10BC)'
      | '10(10D)'
      | '10(11)'
      | '10(12)'
      | '10(12C)'
      | '10(13)'
      | '10(16)'
      | '10(17)'
      | '10(17A)'
      | '10(18)'
      | 'DMDP'
      | '10(19)'
      | '10(26)'
      | '10(26AAA)'
      | 'OTH'
    );
  OthNatOfInc?: NonEmptyString;
  OthAmount: number;
}
/**
 * Long Term capital gains u/s 112A
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "LTCG112A".
 */
export interface LTCG112A {
  TotSaleCnsdrn: number;
  TotCstAcqisn: number;
  LongCap112A: number;
}
/**
 * Verification declaration details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "Verification".
 */
export interface Verification {
  Declaration: {
    AssesseeVerName: NonEmptyString;
    FatherName: NonEmptyString;
    AssesseeVerPAN: NonEmptyString;
  };
  /**
   * S : Self; R : Representative; K : Karta; P : Partner
   */
  Capacity: 'S' | 'R' | 'K' | 'P';
  Place: NonEmptyString;
}
/**
 * TRP details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TaxReturnPreparer".
 */
export interface TaxReturnPreparer {
  IdentificationNoOfTRP: NonEmptyString;
  NameOfTRP: NonEmptyString;
  ReImbFrmGov?: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ScheduleBP".
 */
export interface ScheduleBP {
  NatOfBus44AD?: NatOfBus44AD[];
  PersumptiveInc44AD?: PersumptiveInc44AD;
  NatOfBus44ADA?: NatOfBus44ADA[];
  PersumptiveInc44ADA?: PersumptiveInc44ADA;
  NatOfBus44AE?: NatOfBus44AE[];
  /**
   * @maxItems 10
   */
  GoodsDtlsUs44AE?:
    | []
    | [GoodsDtlsUs44AE]
    | [GoodsDtlsUs44AE, GoodsDtlsUs44AE]
    | [GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE]
    | [GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE]
    | [GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE]
    | [GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE, GoodsDtlsUs44AE]
    | [
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE
      ]
    | [
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE
      ]
    | [
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE
      ]
    | [
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE,
        GoodsDtlsUs44AE
      ];
  PersumptiveInc44AE?: PersumptiveInc44AE;
  TurnoverGrsRcptForGSTIN?: TurnoverGrsRcptForGSTIN[];
  TotalTurnoverGrsRcptGSTIN?: number;
  FinanclPartclrOfBusiness?: FinanclPartclrOfBusiness;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "NatOfBus44AD".
 */
export interface NatOfBus44AD {
  NameOfBusiness: NonEmptyString;
  /**
   * 01001 - Growing and manufacturing of tea , 01002 - Growing and manufacturing of coffee , 01003 - Growing and manufacturing of rubber , 01004 - Market gardening and horticulture specialties , 01005 - Raising of silk worms and production of silk , 01006 - Raising of bees and production of honey , 01007 - Raising of poultry and production of eggs , 01008 - Rearing of sheep and production of wool , 01009 - Rearing of animals and production of animal products , 01010 - Agricultural and animal husbandry services , 01011 - Soil conservation, soil testing and soil desalination services , 01012 - Hunting, trapping and game propagation services , 01013 - Growing of timber, plantation, operation of tree nurseries and conserving of forest , 01014 - Gathering of tendu leaves , 01015 - Gathering of other wild growing materials , 01016 - Forestry service activities, timber cruising, afforestation and reforestation , 01017 - Logging service activities, transport of logs within the forest , 01018 - Other agriculture, animal husbandry or forestry activity n.e.c , 02001 - Fishing on commercial basis in inland waters , 02002 - Fishing on commercial basis in ocean and coastal areas , 02003 - Fish farming , 02004 - Gathering of marine materials such as natural pearls, sponges, coral etc. , 02005 - Services related to marine and fresh water fisheries, fish hatcheries and fish farms , 02006 - Other Fish farming activity n.e.c , 03001 - Mining and agglomeration of hard coal , 03002 - Mining and agglomeration of lignite , 03003 - Extraction and agglomeration of peat , 03004 - Extraction of crude petroleum and natural gas , 03005 - Service activities incidental to oil and gas extraction excluding surveying , 03006 - Mining of uranium and thorium ores , 03007 - Mining of iron ores , 03008 - Mining of non-ferrous metal ores, except uranium and thorium ores , 03009 - Mining of gemstones , 03010 - Mining of chemical and fertilizer minerals , 03011 - Mining of quarrying of abrasive materials , 03012 - Mining of mica, graphite and asbestos , 03013 - Quarrying of stones (marble/granite/dolomite), sand and clay , 03014 - Other mining and quarrying , 03015 - Mining and production of salt , 03016 - Other mining and quarrying n.e.c , 04001 - Production, processing and preservation of meat and meat products , 04002 - Production, processing and preservation of fish and fish products , 04003 - Manufacture of vegetable oil, animal oil and fats , 04004 - Processing of fruits, vegetables and edible nuts , 04005 - Manufacture of dairy products , 04006 - Manufacture of sugar , 04007 - Manufacture of cocoa, chocolates and sugar confectionery , 04008 - Flour milling , 04009 - Rice milling , 04010 - Dal milling , 04011 - Manufacture of other grain mill products , 04012 - Manufacture of bakery products , 04013 - Manufacture of starch products , 04014 - Manufacture of animal feeds , 04015 - Manufacture of other food products , 04016 - Manufacturing of wines , 04017 - Manufacture of beer , 04018 - Manufacture of malt liquors , 04019 - Distilling and blending of spirits, production of ethyl alcohol , 04020 - Manufacture of mineral water , 04021 - Manufacture of soft drinks , 04022 - Manufacture of other non-alcoholic beverages , 04023 - Manufacture of tobacco products , 04024 - Manufacture of textiles (other than by handloom) , 04025 - Manufacture of textiles using handlooms (khadi) , 04026 - Manufacture of carpet, rugs, blankets, shawls etc. (other than by hand) , 04027 - Manufacture of carpet, rugs, blankets, shawls etc. by hand , 04028 - Manufacture of wearing apparel , 04029 - Tanning and dressing of leather , 04030 - Manufacture of luggage, handbags and the like saddler and harness , 04031 - Manufacture of footwear , 04032 - Manufacture of wood and wood products, cork, straw and plaiting material , 04033 - Manufacture of paper and paper products , 04034 - Publishing, printing and reproduction of recorded media , 04035 - Manufacture of coke oven products , 04036 - Manufacture of refined petroleum products , 04037 - Processing of nuclear fuel , 04038 - Manufacture of fertilizers and nitrogen compounds , 04039 - Manufacture of plastics in primary forms and of synthetic rubber , 04040 - Manufacture of paints, varnishes and similar coatings , 04041 - Manufacture of pharmaceuticals, medicinal chemicals and botanical products , 04042 - Manufacture of soap and detergents , 04043 - Manufacture of other chemical products , 04044 - Manufacture of man-made fibers , 04045 - Manufacture of rubber products , 04046 - Manufacture of plastic products , 04047 - Manufacture of glass and glass products , 04048 - Manufacture of cement, lime and plaster , 04049 - Manufacture of articles of concrete, cement and plaster , 04050 - Manufacture of Bricks , 04051 - Manufacture of other clay and ceramic products , 04052 - Manufacture of other non-metallic mineral products , 04053 - Manufacture of pig iron, sponge iron, Direct Reduced Iron etc. , 04054 - Manufacture of Ferro alloys , 04055 - Manufacture of Ingots, billets, blooms and slabs etc. , 04056 - Manufacture of steel products , 04057 - Manufacture of basic precious and non-ferrous metals , 04058 - Manufacture of non-metallic mineral products , 04059 - Casting of metals , 04060 - Manufacture of fabricated metal products , 04061 - Manufacture of engines and turbines , 04062 - Manufacture of pumps and compressors , 04063 - Manufacture of bearings and gears , 04064 - Manufacture of ovens and furnaces , 04065 - Manufacture of lifting and handling equipment , 04066 - Manufacture of other general purpose machinery , 04067 - Manufacture of agricultural and forestry machinery , 04068 - Manufacture of Machine Tools , 04069 - Manufacture of machinery for metallurgy , 04070 - Manufacture of machinery for mining, quarrying and constructions , 04071 - Manufacture of machinery for processing of food and beverages , 04072 - Manufacture of machinery for leather and textile , 04073 - Manufacture of weapons and ammunition , 04074 - Manufacture of other special purpose machinery , 04075 - Manufacture of domestic appliances , 04076 - Manufacture of office, accounting and computing machinery , 04077 - Manufacture of electrical machinery and apparatus , 04078 - Manufacture of Radio, Television, communication equipment and apparatus , 04079 - Manufacture of medical and surgical equipment , 04080 - Manufacture of industrial process control equipment , 04081 - Manufacture of instruments and appliances for measurements and navigation , 04082 - Manufacture of optical instruments , 04083 - Manufacture of watches and clocks , 04084 - Manufacture of motor vehicles , 04085 - Manufacture of body of motor vehicles , 04086 - Manufacture of parts and accessories of motor vehicles and engines , 04087 - Building and repair of ships and boats , 04088 - Manufacture of railway locomotive and rolling stocks , 04089 - Manufacture of aircraft and spacecraft , 04090 - Manufacture of bicycles , 04091 - Manufacture of other transport equipment , 04092 - Manufacture of furniture , 04093 - Manufacture of jewellery , 04094 - Manufacture of sports goods , 04095 - Manufacture of musical instruments , 04096 - Manufacture of games and toys , 04097 - Other manufacturing n.e.c. , 04098 - Recycling of metal waste and scrap , 04099 - Recycling of non- metal waste and scrap , 05001 - Production, collection and distribution of electricity , 05002 - Manufacture and distribution of gas , 05003 - Collection, purification and distribution of water , 05004 - Other essential commodity service n.e.c , 06001 - Site preparation works , 06002 - Building of complete constructions or parts- civil contractors , 06003 - Building installation , 06004 - Building completion , 06005 - Construction and maintenance of roads, rails, bridges, tunnels, ports, harbour, runways etc. , 06006 - Construction and maintenance of power plants , 06007 - Construction and maintenance of industrial plants , 06008 - Construction and maintenance of power transmission and telecommunication lines , 06009 - Construction of water ways and water reservoirs , 06010 - Other construction activity n.e.c. , 07001 - Purchase, sale and letting of leased buildings (residential and non-residential) , 07002 - Operating of real estate of self-owned buildings (residential and non-residential) , 07003 - Developing and sub-dividing real estate into lots , 07004 - Real estate activities on a fee or contract basis , 07005 - Other real estate/renting services n.e.c , 08001 - Renting of land transport equipment , 08002 - Renting of water transport equipment , 08003 - Renting of air transport equipment , 08004 - Renting of agricultural machinery and equipment , 08005 - Renting of construction and civil engineering machinery , 08006 - Renting of office machinery and equipment , 08007 - Renting of other machinery and equipment n.e.c. , 08008 - Renting of personal and household goods n.e.c. , 08009 - Renting of other machinery n.e.c. , 09001 - Wholesale and retail sale of motor vehicles , 09002 - Repair and maintenance of motor vehicles , 09003 - Sale of motor parts and accessories- wholesale and retail , 09004 - Retail sale of automotive fuel , 09006 - Wholesale of agricultural raw material , 09007 - Wholesale of food and beverages and tobacco , 09008 - Wholesale of household goods , 09009 - Wholesale of metals and metal ores , 09010 - Wholesale of household goods , 09011 - Wholesale of construction material , 09012 - Wholesale of hardware and sanitary fittings , 09013 - Wholesale of cotton and jute , 09014 - Wholesale of raw wool and raw silk , 09015 - Wholesale of other textile fibres , 09016 - Wholesale of industrial chemicals , 09017 - Wholesale of fertilizers and pesticides , 09018 - Wholesale of electronic parts and equipment , 09019 - Wholesale of other machinery, equipment and supplies , 09020 - Wholesale of waste, scrap and materials for re-cycling , 09021 - Retail sale of food, beverages and tobacco in specialized stores , 09022 - Retail sale of other goods in specialized stores , 09023 - Retail sale in non-specialized stores , 09024 - Retail sale of textiles, apparel, footwear, leather goods , 09025 - Retail sale of other household appliances , 09026 - Retail sale of hardware, paint and glass , 09027 - Wholesale of other products n.e.c , 09028 - Retail sale of other products n.e.c , 09029 - Commission agents - Kachcha Arahtia, 10001 - Hotels – Star rated , 10002 - Hotels – Non-star rated , 10003 - Motels, Inns and Dharmshalas , 10004 - Guest houses and circuit houses , 10005 - Dormitories and hostels at educational institutions , 10006 - Short stay accommodations n.e.c. , 10007 - Restaurants – with bars , 10008 - Restaurants – without bars , 10009 - Canteens , 10010 - Independent caterers , 10011 - Casinos and other games of chance , 10012 - Other hospitality services n.e.c. , 11001 - Travel agencies and tour operators , 11002 - Packers and movers , 11003 - Passenger land transport , 11004 - Air transport , 11005 - Transport by urban/sub-urban railways , 11006 - Inland water transport , 11007 - Sea and coastal water transport , 11008 - Freight transport by road , 11009 - Freight transport by railways , 11010 - Forwarding of freight , 11011 - Receiving and acceptance of freight , 11012 - Cargo handling , 11013 - Storage and warehousing , 11014 - Transport via pipelines (transport of gases, liquids, slurry and other commodities) , 11015 - Other Transport and Logistics services n.e.c , 12001 - Post and courier activities , 12002 - Basic telecom services , 12003 - Value added telecom services , 12004 - Maintenance of telecom network , 12005 - Activities of the cable operators , 12006 - Other Post and Telecommunication services n.e.c , 13001 - Commercial banks, saving banks and discount houses , 13002 - Specialised institutions granting credit , 13003 - Financial leasing , 13004 - Hire-purchase financing , 13005 - Housing finance activities , 13006 - Commercial loan activities , 13007 - Credit cards , 13008 - Mutual funds , 13009 - Chit fund , 13010 - Investment activities , 13011 - Life insurance , 13012 - Pension funding , 13013 - Non-life insurance , 13014 - Administration of financial markets , 13015 - Stock brokers, sub-brokers and related activities , 13016 - Financial advisers, mortgage advisers and brokers , 13017 - Foreign exchange services , 13018 - Other financial intermediation services n.e.c. , 14007 - Cyber café , 14009 - Computer training and educational institutes , 14010 - Other computation related services n.e.c. , 15001 - Natural sciences and engineering , 15002 - Social sciences and humanities , 15003 - Other Research and Development activities n.e.c. , 16006 - Advertising , 16010 - Auctioneers , 16012 - Market research and public opinion polling , 16014 - Labour recruitment and provision of personnel , 16015 - Investigation and security services , 16016 - Building-cleaning and industrial cleaning activities , 16017 - Packaging activities , 16019 - Other professional services n.e.c. , 17001 - Primary education , 17002 - Secondary/ senior secondary education , 17003 - Technical and vocational secondary/ senior secondary education , 17004 - Higher education , 17005 - Education by correspondence , 17006 - Coaching centres and tuitions , 17007 - Other education services n.e.c. , 18006 - Independent blood banks , 18007 - Medical transcription , 18008 - Independent ambulance services , 18009 - Medical suppliers, agencies and stores , 19001 - Social work activities with accommodation (orphanages and old age homes) , 19002 - Social work activities without accommodation (Creches) , 19003 - Industry associations, chambers of commerce , 19004 - Professional organisations , 19005 - Trade unions , 19006 - Religious organizations , 19007 - Political organisations , 19008 - Other membership organisations n.e.c. (rotary clubs, book clubs and philatelic clubs) , 19009 - Other Social or community service n.e.c , 20001 - Motion picture production , 20002 - Film distribution , 20003 - Film laboratories , 20004 - Television channel productions , 20005 - Television channels broadcast , 20006 - Video production and distribution , 20007 - Sound recording studios , 20008 - Radio - recording and distribution , 20009 - Stage production and related activities , 20013 - Circuses and race tracks , 20014 - Video Parlours , 20015 - News agency activities , 20016 - Library and archives activities , 20017 - Museum activities , 20018 - Preservation of historical sites and buildings , 20019 - Botanical and zoological gardens , 20020 - Operation and maintenance of sports facilities , 20021 - Activities of sports and game schools , 20022 - Organisation and operation of indoor/outdoor sports and promotion and production of sporting events , 20023_1 - Sports Management, 20023 - Other sporting activities n.e.c. , 20024 - Other recreational activities n.e.c. , 21001 - Hair dressing and other beauty treatment , 21002 - Funeral and related activities , 21003 - Marriage bureaus , 21004 - Pet care services , 21005 - Sauna and steam baths, massage salons etc. , 21006 - Astrological and spiritualists’ activities , 21007 - Private households as employers of domestic staff , 21008_1 - Event Management, 21008 - Other services n.e.c. , 21009 - Speculative trading , 21010 - Futures and Options trading , 21011 - Buying and selling shares, 22001 - Extra territorial organisations and bodies (IMF, World Bank,European Commission etc.)
   */
  CodeAD: NonEmptyString &
    (
      | '01001'
      | '01002'
      | '01003'
      | '01004'
      | '01005'
      | '01006'
      | '01007'
      | '01008'
      | '01009'
      | '01010'
      | '01011'
      | '01012'
      | '01013'
      | '01014'
      | '01015'
      | '01016'
      | '01017'
      | '01018'
      | '02001'
      | '02002'
      | '02003'
      | '02004'
      | '02005'
      | '02006'
      | '03001'
      | '03002'
      | '03003'
      | '03004'
      | '03005'
      | '03006'
      | '03007'
      | '03008'
      | '03009'
      | '03010'
      | '03011'
      | '03012'
      | '03013'
      | '03014'
      | '03015'
      | '03016'
      | '04001'
      | '04002'
      | '04003'
      | '04004'
      | '04005'
      | '04006'
      | '04007'
      | '04008'
      | '04009'
      | '04010'
      | '04011'
      | '04012'
      | '04013'
      | '04014'
      | '04015'
      | '04016'
      | '04017'
      | '04018'
      | '04019'
      | '04020'
      | '04021'
      | '04022'
      | '04023'
      | '04024'
      | '04025'
      | '04026'
      | '04027'
      | '04028'
      | '04029'
      | '04030'
      | '04031'
      | '04032'
      | '04033'
      | '04034'
      | '04035'
      | '04036'
      | '04037'
      | '04038'
      | '04039'
      | '04040'
      | '04041'
      | '04042'
      | '04043'
      | '04044'
      | '04045'
      | '04046'
      | '04047'
      | '04048'
      | '04049'
      | '04050'
      | '04051'
      | '04052'
      | '04053'
      | '04054'
      | '04055'
      | '04056'
      | '04057'
      | '04058'
      | '04059'
      | '04060'
      | '04061'
      | '04062'
      | '04063'
      | '04064'
      | '04065'
      | '04066'
      | '04067'
      | '04068'
      | '04069'
      | '04070'
      | '04071'
      | '04072'
      | '04073'
      | '04074'
      | '04075'
      | '04076'
      | '04077'
      | '04078'
      | '04079'
      | '04080'
      | '04081'
      | '04082'
      | '04083'
      | '04084'
      | '04085'
      | '04086'
      | '04087'
      | '04088'
      | '04089'
      | '04090'
      | '04091'
      | '04092'
      | '04093'
      | '04094'
      | '04095'
      | '04096'
      | '04097'
      | '04098'
      | '04099'
      | '05001'
      | '05002'
      | '05003'
      | '05004'
      | '06001'
      | '06002'
      | '06003'
      | '06004'
      | '06005'
      | '06006'
      | '06007'
      | '06008'
      | '06009'
      | '06010'
      | '07001'
      | '07002'
      | '07003'
      | '07004'
      | '07005'
      | '08001'
      | '08002'
      | '08003'
      | '08004'
      | '08005'
      | '08006'
      | '08007'
      | '08008'
      | '08009'
      | '09001'
      | '09002'
      | '09003'
      | '09004'
      | '09006'
      | '09007'
      | '09008'
      | '09009'
      | '09010'
      | '09011'
      | '09012'
      | '09013'
      | '09014'
      | '09015'
      | '09016'
      | '09017'
      | '09018'
      | '09019'
      | '09020'
      | '09021'
      | '09022'
      | '09023'
      | '09024'
      | '09025'
      | '09026'
      | '09027'
      | '09028'
      | '09029'
      | '10001'
      | '10002'
      | '10003'
      | '10004'
      | '10005'
      | '10006'
      | '10007'
      | '10008'
      | '10009'
      | '10010'
      | '10011'
      | '10012'
      | '11001'
      | '11002'
      | '11003'
      | '11004'
      | '11005'
      | '11006'
      | '11007'
      | '11008'
      | '11009'
      | '11010'
      | '11011'
      | '11012'
      | '11013'
      | '11014'
      | '11015'
      | '12001'
      | '12002'
      | '12003'
      | '12004'
      | '12005'
      | '12006'
      | '13001'
      | '13002'
      | '13003'
      | '13004'
      | '13005'
      | '13006'
      | '13007'
      | '13008'
      | '13009'
      | '13010'
      | '13011'
      | '13012'
      | '13013'
      | '13014'
      | '13015'
      | '13016'
      | '13017'
      | '13018'
      | '14007'
      | '14009'
      | '14010'
      | '15001'
      | '15002'
      | '15003'
      | '16006'
      | '16010'
      | '16012'
      | '16014'
      | '16015'
      | '16016'
      | '16017'
      | '16019'
      | '17001'
      | '17002'
      | '17003'
      | '17004'
      | '17005'
      | '17006'
      | '17007'
      | '18006'
      | '18007'
      | '18008'
      | '18009'
      | '19001'
      | '19002'
      | '19003'
      | '19004'
      | '19005'
      | '19006'
      | '19007'
      | '19008'
      | '19009'
      | '20001'
      | '20002'
      | '20003'
      | '20004'
      | '20005'
      | '20006'
      | '20007'
      | '20008'
      | '20009'
      | '20013'
      | '20014'
      | '20015'
      | '20016'
      | '20017'
      | '20018'
      | '20019'
      | '20020'
      | '20021'
      | '20022'
      | '20023_1'
      | '20023'
      | '20024'
      | '21001'
      | '21002'
      | '21003'
      | '21004'
      | '21005'
      | '21006'
      | '21007'
      | '21008_1'
      | '21008'
      | '21009'
      | '21010'
      | '21011'
      | '22001'
    );
  Description?: NonEmptyString;
}
/**
 * Computation of Persumptive Income Under 44AD
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "PersumptiveInc44AD".
 */
export interface PersumptiveInc44AD {
  GrsTotalTrnOver: number;
  GrsTrnOverBank?: number;
  GrsTotalTrnOverInCash?: number;
  GrsTrnOverAnyOthMode?: number;
  PersumptiveInc44AD6Per?: number;
  PersumptiveInc44AD8Per?: number;
  TotPersumptiveInc44AD: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "NatOfBus44ADA".
 */
export interface NatOfBus44ADA {
  NameOfBusiness: NonEmptyString;
  /**
   * 14001 - Software development , 14002 - Other software consultancy , 14003 - Data processing , 14004 - Database activities and distribution of electronic content , 14005 - Other IT enabled services , 14006 - BPO services , 14008 - Maintenance and repair of office, accounting and computing machinery , 16001 - Legal profession , 16002 - Accounting, book-keeping and auditing profession , 16003 - Tax consultancy , 16004 - Architectural profession , 16005 - Engineering and technical consultancy , 16007 - Fashion designing , 16008 - Interior decoration , 16009 - Photography , 16013 - Business and management consultancy activities , 16018 - Secretarial activities , 16019_1 - Medical Profession, 16020 - Film Artist, 16021 - Social Media Influencers , 18001 - General hospitals , 18002 - Speciality and super speciality hospitals , 18003 - Nursing homes , 18004 - Diagnostic centres , 18005 - Pathological laboratories , 18010 - Medical clinics , 18011 - Dental practice , 18012 - Ayurveda practice , 18013 - Unani practice , 18014 - Homeopathy practice , 18015 - Nurses, physiotherapists or other para-medical practitioners , 18016 - Veterinary hospitals and practice , 18017 - Medical education , 18018 - Medical research , 18019 - Practice of other alternative medicine, 18020 - Other healthcare services , 20010 - Individual artists excluding authors , 20011 - Literary activities , 20012 - Other cultural activities n.e.c.
   */
  CodeADA: NonEmptyString &
    (
      | '14001'
      | '14002'
      | '14003'
      | '14004'
      | '14005'
      | '14006'
      | '14008'
      | '16001'
      | '16002'
      | '16003'
      | '16004'
      | '16005'
      | '16007'
      | '16008'
      | '16009'
      | '16013'
      | '16018'
      | '16019_1'
      | '16020'
      | '16021'
      | '18001'
      | '18002'
      | '18003'
      | '18004'
      | '18005'
      | '18010'
      | '18011'
      | '18012'
      | '18013'
      | '18014'
      | '18015'
      | '18016'
      | '18017'
      | '18018'
      | '18019'
      | '18020'
      | '20010'
      | '20011'
      | '20012'
    );
  Description?: NonEmptyString;
}
/**
 * Computation of Persumptive Income Under 44ADA (Profession)
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "PersumptiveInc44ADA".
 */
export interface PersumptiveInc44ADA {
  GrsReceipt: number;
  GrsTrnOverBank44ADA?: number;
  GrsTotalTrnOverInCash44ADA?: number;
  GrsTrnOverAnyOthMode44ADA?: number;
  TotPersumptiveInc44ADA: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "NatOfBus44AE".
 */
export interface NatOfBus44AE {
  NameOfBusiness: NonEmptyString;
  /**
   * 08001 - Renting of land transport equipment, 11002 - Packers and movers, 11008 - Freight transport by road, 11010 - Forwarding of freight, 11011 - Receiving and acceptance of freight, 11012 - Cargo handling, 11015 - Other Transport and Logistics services n.e.c
   */
  CodeAE: NonEmptyString & ('08001' | '11002' | '11008' | '11010' | '11011' | '11012' | '11015');
  Description?: NonEmptyString;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "GoodsDtlsUs44AE".
 */
export interface GoodsDtlsUs44AE {
  RegNumberGoodsCarriage: NonEmptyString;
  /**
   * OWN : Owned; LEASE : Leased; HIRED : Hired
   */
  OwnedLeasedHiredFlag: 'OWN' | 'LEASE' | 'HIRED';
  TonnageCapacity: number;
  /**
   * Holding period in months.
   */
  HoldingPeriod: number;
  PresumptiveIncome: number;
}
/**
 * Computation of Persumptive Income Under 44AE
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "PersumptiveInc44AE".
 */
export interface PersumptiveInc44AE {
  TotPersumInc44AE: number;
  SalInterestByFirm?: number;
  TotalPersumptiveInc: number;
  IncChargeableUnderBus: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TurnoverGrsRcptForGSTIN".
 */
export interface TurnoverGrsRcptForGSTIN {
  GSTINNo: NonEmptyString;
  AmtTurnGrossRcptGSTIN: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "FinanclPartclrOfBusiness".
 */
export interface FinanclPartclrOfBusiness {
  PartnerMemberOwnCapital?: number;
  SecuredLoans?: number;
  UnSecuredLoans?: number;
  Advances?: number;
  SundryCreditors?: number;
  OthrCurrLiab?: number;
  TotCapLiabilities?: number;
  FixedAssets?: number;
  Inventories?: number;
  SundryDebtors?: number;
  BalWithBanks?: number;
  CashInHand?: number;
  LoansAndAdvances?: number;
  OtherAssets?: number;
  TotalAssets?: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ScheduleIT".
 */
export interface ScheduleIT {
  /**
   * @minItems 1
   */
  TaxPayment?: [TaxPayment, ...TaxPayment[]];
  TotalTaxPayments: number;
}
/**
 * Tax payment detail
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TaxPayment".
 */
export interface TaxPayment {
  BSRCode: NonEmptyString;
  /**
   * Date of deposit should be on or after 2024-04-01  in YYYY-MM-DD format
   */
  DateDep: string;
  SrlNoOfChaln: number;
  Amt: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ScheduleTCS".
 */
export interface ScheduleTCS {
  /**
   * @minItems 1
   */
  TCS?: [
    {
      EmployerOrDeductorOrCollectDetl: EmployerOrDeductorOrCollectDetl;
      Amtfrom26AS: number;
      TotalTCS: number;
      AmtTCSClaimedThisYear: number;
    },
    ...{
      EmployerOrDeductorOrCollectDetl: EmployerOrDeductorOrCollectDetl;
      Amtfrom26AS: number;
      TotalTCS: number;
      AmtTCSClaimedThisYear: number;
    }[]
  ];
  TotalSchTCS: number;
}
/**
 * Dedcutor Details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "EmployerOrDeductorOrCollectDetl".
 */
export interface EmployerOrDeductorOrCollectDetl {
  TAN: NonEmptyString;
  EmployerOrDeductorOrCollecterName: NonEmptyString;
}
/**
 * Salary TDS details
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TDSonSalaries".
 */
export interface TDSonSalaries {
  /**
   * @minItems 1
   */
  TDSonSalary?: [TDSonSalary, ...TDSonSalary[]];
  TotalTDSonSalaries: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TDSonSalary".
 */
export interface TDSonSalary {
  EmployerOrDeductorOrCollectDetl: EmployerOrDeductorOrCollectDetl;
  IncChrgSal: number;
  TotalTDSSal: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TDSonOthThanSals".
 */
export interface TDSonOthThanSals {
  /**
   * @minItems 1
   */
  TDSonOthThanSalDtls?: [TDSonOthThanSalDtls, ...TDSonOthThanSalDtls[]];
  TotalTDSonOthThanSals: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TDSonOthThanSalDtls".
 */
export interface TDSonOthThanSalDtls {
  TANOfDeductor: NonEmptyString;
  DeductedYr?: NonEmptyString &
    (
      | '2023'
      | '2022'
      | '2021'
      | '2020'
      | '2019'
      | '2018'
      | '2017'
      | '2016'
      | '2015'
      | '2014'
      | '2013'
      | '2012'
      | '2011'
      | '2010'
      | '2009'
      | '2008'
    );
  BroughtFwdTDSAmt?: number;
  TDSDeducted?: number;
  /**
   * 92A:192- Salary-Payment to Government employees other than Indian Government employees; 92B:192- Salary-Payment to employees other than Government employees; 92C:192- Salary-Payment to Indian Government employees; 192A:192A/2AA- TDS on PF withdrawal; 193:193- Interest on Securities; 194:194- Dividends; 94A:194A- Interest other than 'Interest on securities'; 94B:194B- Winning from lottery or crossword puzzle; 94BA:194BA- Winnings from online games; 4BB:194BB- Winning from horse race; 94C:194C- Payments to contractors and sub-contractors; 94D:194D- Insurance commission; 4DA:194DA- Payment in respect of life insurance policy; 94E:194E- Payments to non-resident sportsmen or sports associations; 4EE:194EE- Payments in respect of deposits under National Savings; 4F:194F/94F- Payments on account of repurchase of units by Mutual Fund or Unit Trust of India; 4G:194G/94G- Commission, price, etc. on sale of lottery tickets; 4H:194H/94H- Commission or brokerage; 4-IA:194I(a)/4IA- Rent on hiring of plant and machinery;  4-IB:194I(b)/4IB - Rent on other than plant and machinery; 4IA:194IA/9IA- TDS on Sale of immovable property; 4IB:194IB/9IB- Payment of rent by certain individuals or Hindu undivided; 4IC:194IC- Payment under specified agreement; 94J-A:194J(a)/4JA - Fees for technical services; 94J-B:194J(b)/4JB- Fees for professional  services or royalty etc; 94K:194K- Income payable to a resident assessee in respect of units of a specified mutual fund or of the units of the Unit Trust of India; 4LA:194LA- Payment of compensation on acquisition of certain immovable; 4LB:194LB- Income by way of Interest from Infrastructure Debt fund; 4LC1:194LC/LC1- 194LC (2)(i) and (ia) Income under clause (i) and (ia) of sub-section (2) of section 194LC; 4LC2:194LC/LC2- 194LC (2)(ib) Income under clause (ib) of sub-section (2) of section 194LC; 4LC3:194LC/LC3- 194LC (2)(ic) Income under clause (ic) of sub-section (2) of section 194LC; 4BA1:194LBA(a)/BA1- Certain income in the form of interest from units of a business trust to a resident unit holder; 4BA2: 194LBA(b)/BA2- Certain income in the form of dividend from units of a business trust to a resident unit holder; LBA1:194LBA(a)/BA1- 194LBA(a) income referred to in section 10(23FC)(a) from units of a business trust-NR; LBA2:194LBA(b)/BA2-194LBA(b) Income referred to in section 10(23FC)(b) from units of a business trust-NR; LBA3:194LBA(c)/BA3- 194LBA(c) Income referred to in section 10(23FCA) from units of a business trust-NR; LBB: 194LBB- Income in respect of units of investment fund; 94R:194R- Benefits or perquisites of business or profession; 94S:194S- Payment of consideration for transfer of virtual digital asset by persons other than specified persons; 94B-P:Proviso to section 194B/4BP- Winnings from lotteries and crossword puzzles where consideration is made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such winnings are released; 94R-P: First Proviso to sub-section(1) of section 194R/4RP- Benefits or perquisites of business or profession where such benefit is provided in kind or where part in cash is not sufficient to meet tax liability and tax required to be deducted is paid before such benefit is released; 94S-P:Proviso to sub- section(1) of section 194S/4SP- Payment for transfer of virtual digital asset where payment is in kind or in exchange of another virtual digital asset and tax required to be deducted is paid before such payment is released; LBC:194LBC- Income in respect of investment in securitization trust; 4LD:194LD- TDS on interest on bonds / government securities; 94M:194M- Payment of certain sums by certain individuals or HUF; 94N:194N- Payment of certain amounts in cash other than cases covered by first proviso or third proviso; 94N-F: 194N/4NF -First Proviso Payment of certain amounts in cash to non-filers except in case of co-operativesocieties; 94N-C:194N/4NC- Third Proviso Payment of certain amounts in cash to co-operative societies not covered by first proviso; 94N-FT: 194N/NFT- First Proviso read with Third Proviso Payment of certain amount in cash to non-filers being co-operative societies; 94O:194O- Payment of certain sums by e-commerce operator to e-commerce participant.; 94P: 194P- Deduction of tax in case of specified senior citizen; 94Q:194Q- Deduction of tax at source on payment of certain sum for purchase of goods; 195:195- Other sums payable to a non-resident; 96A:196A- Income in respect of units of non-residents; 96B:196B- Payments in respect of units to an offshore fund; 96C:196C- Income from foreign currency bonds or shares of Indian; 96D:196D- Income of foreign institutional investors from securities; 96DA:196D(1A)/6DA- Income of specified fund from securities; 94BA-P: 194BA(2)/BAP-Sub-section (2) of section 194BA Net Winnings from online games where the net winnings are made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such net winnings are released;
   */
  TDSSection: NonEmptyString &
    (
      | '92A'
      | '92B'
      | '92C'
      | '192A'
      | '193'
      | '194'
      | '94A'
      | '94B'
      | '94BA'
      | '4BB'
      | '94C'
      | '94D'
      | '4DA'
      | '94E'
      | '4EE'
      | '4F'
      | '4G'
      | '4H'
      | '4-IA'
      | '4-IB'
      | '4IA'
      | '4IB'
      | '4IC'
      | '94J-A'
      | '94J-B'
      | '94K'
      | '4LA'
      | '4LB'
      | '4LC1'
      | '4LC2'
      | '4LC3'
      | '4BA1'
      | '4BA2'
      | 'LBA1'
      | 'LBA2'
      | 'LBA3'
      | 'LBB'
      | '94R'
      | '94S'
      | '94B-P'
      | '94R-P'
      | '94S-P'
      | 'LBC'
      | '4LD'
      | '94M'
      | '94N'
      | '94N-F'
      | '94N-C'
      | '94N-FT'
      | '94O'
      | '94P'
      | '94Q'
      | '195'
      | '96A'
      | '96B'
      | '96C'
      | '96D'
      | '96DA'
      | '94BA-P'
    );
  TDSClaimed: number;
  GrossAmount?: number;
  /**
   * BP - Income from business and Profession; HP - Income from House Property; OS - Income from Other Source; EI - Exempt Income, NA - Not Applicable
   */
  HeadOfIncome?: 'BP' | 'HP' | 'OS' | 'EI' | 'NA';
  TDSCreditCarriedFwd: number;
}
/**
 * Details of Tax Deducted at Source [16C furnished by the Deductor(s)]
 *
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "ScheduleTDS3Dtls".
 */
export interface ScheduleTDS3Dtls {
  /**
   * @minItems 1
   */
  TDS3Details?: [TDS3Details, ...TDS3Details[]];
  TotalTDS3Details: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "TDS3Details".
 */
export interface TDS3Details {
  PANofTenant: NonEmptyString;
  AadhaarofTenant?: NonEmptyString;
  DeductedYr?: NonEmptyString & ('2023' | '2022' | '2021' | '2020' | '2019' | '2018' | '2017');
  BroughtFwdTDSAmt?: number;
  TDSDeducted?: number;
  /**
   * 92A:192- Salary-Payment to Government employees other than Indian Government employees; 92B:192- Salary-Payment to employees other than Government employees; 92C:192- Salary-Payment to Indian Government employees; 192A:192A/2AA- TDS on PF withdrawal; 193:193- Interest on Securities; 194:194- Dividends; 94A:194A- Interest other than 'Interest on securities'; 94B:194B- Winning from lottery or crossword puzzle; 94BA:194BA- Winnings from online games; 4BB:194BB- Winning from horse race; 94C:194C- Payments to contractors and sub-contractors; 94D:194D- Insurance commission; 4DA:194DA- Payment in respect of life insurance policy; 94E:194E- Payments to non-resident sportsmen or sports associations; 4EE:194EE- Payments in respect of deposits under National Savings; 4F:194F/94F- Payments on account of repurchase of units by Mutual Fund or Unit Trust of India; 4G:194G/94G- Commission, price, etc. on sale of lottery tickets; 4H:194H/94H- Commission or brokerage; 4-IA:194I(a)/4IA- Rent on hiring of plant and machinery;  4-IB:194I(b)/4IB - Rent on other than plant and machinery; 4IA:194IA/9IA- TDS on Sale of immovable property; 4IB:194IB/9IB- Payment of rent by certain individuals or Hindu undivided; 4IC:194IC- Payment under specified agreement; 94J-A:194J(a)/4JA - Fees for technical services; 94J-B:194J(b)/4JB- Fees for professional  services or royalty etc; 94K:194K- Income payable to a resident assessee in respect of units of a specified mutual fund or of the units of the Unit Trust of India; 4LA:194LA- Payment of compensation on acquisition of certain immovable; 4LB:194LB- Income by way of Interest from Infrastructure Debt fund; 4LC1:194LC/LC1- 194LC (2)(i) and (ia) Income under clause (i) and (ia) of sub-section (2) of section 194LC; 4LC2:194LC/LC2- 194LC (2)(ib) Income under clause (ib) of sub-section (2) of section 194LC; 4LC3:194LC/LC3- 194LC (2)(ic) Income under clause (ic) of sub-section (2) of section 194LC; 4BA1:194LBA(a)/BA1- Certain income in the form of interest from units of a business trust to a resident unit holder; 4BA2: 194LBA(b)/BA2- Certain income in the form of dividend from units of a business trust to a resident unit holder; LBA1:194LBA(a)/BA1- 194LBA(a) income referred to in section 10(23FC)(a) from units of a business trust-NR; LBA2:194LBA(b)/BA2-194LBA(b) Income referred to in section 10(23FC)(b) from units of a business trust-NR; LBA3:194LBA(c)/BA3- 194LBA(c) Income referred to in section 10(23FCA) from units of a business trust-NR; LBB: 194LBB- Income in respect of units of investment fund; 94R:194R- Benefits or perquisites of business or profession; 94S:194S- Payment of consideration for transfer of virtual digital asset by persons other than specified persons; 94B-P:Proviso to section 194B/4BP- Winnings from lotteries and crossword puzzles where consideration is made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such winnings are released; 94R-P: First Proviso to sub-section(1) of section 194R/4RP- Benefits or perquisites of business or profession where such benefit is provided in kind or where part in cash is not sufficient to meet tax liability and tax required to be deducted is paid before such benefit is released; 94S-P:Proviso to sub- section(1) of section 194S/4SP- Payment for transfer of virtual digital asset where payment is in kind or in exchange of another virtual digital asset and tax required to be deducted is paid before such payment is released; LBC:194LBC- Income in respect of investment in securitization trust; 4LD:194LD- TDS on interest on bonds / government securities; 94M:194M- Payment of certain sums by certain individuals or HUF; 94N:194N- Payment of certain amounts in cash other than cases covered by first proviso or third proviso; 94N-F: 194N/4NF -First Proviso Payment of certain amounts in cash to non-filers except in case of co-operativesocieties; 94N-C:194N/4NC- Third Proviso Payment of certain amounts in cash to co-operative societies not covered by first proviso; 94N-FT: 194N/NFT- First Proviso read with Third Proviso Payment of certain amount in cash to non-filers being co-operative societies; 94O:194O- Payment of certain sums by e-commerce operator to e-commerce participant.; 94P: 194P- Deduction of tax in case of specified senior citizen; 94Q:194Q- Deduction of tax at source on payment of certain sum for purchase of goods; 195:195- Other sums payable to a non-resident; 96A:196A- Income in respect of units of non-residents; 96B:196B- Payments in respect of units to an offshore fund; 96C:196C- Income from foreign currency bonds or shares of Indian; 96D:196D- Income of foreign institutional investors from securities; 96DA:196D(1A)/6DA- Income of specified fund from securities; 94BA-P: 194BA(2)/BAP-Sub-section (2) of section 194BA Net Winnings from online games where the net winnings are made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such net winnings are released;
   */
  TDSSection: NonEmptyString &
    (
      | '92A'
      | '92B'
      | '92C'
      | '192A'
      | '193'
      | '194'
      | '94A'
      | '94B'
      | '94BA'
      | '4BB'
      | '94C'
      | '94D'
      | '4DA'
      | '94E'
      | '4EE'
      | '4F'
      | '4G'
      | '4H'
      | '4-IA'
      | '4-IB'
      | '4IA'
      | '4IB'
      | '4IC'
      | '94J-A'
      | '94J-B'
      | '94K'
      | '4LA'
      | '4LB'
      | '4LC1'
      | '4LC2'
      | '4LC3'
      | '4BA1'
      | '4BA2'
      | 'LBA1'
      | 'LBA2'
      | 'LBA3'
      | 'LBB'
      | '94R'
      | '94S'
      | '94B-P'
      | '94R-P'
      | '94S-P'
      | 'LBC'
      | '4LD'
      | '94M'
      | '94N'
      | '94N-F'
      | '94N-C'
      | '94N-FT'
      | '94O'
      | '94P'
      | '94Q'
      | '195'
      | '96A'
      | '96B'
      | '96C'
      | '96D'
      | '96DA'
      | '94BA-P'
    );
  TDSClaimed: number;
  GrossAmount?: number;
  /**
   * HP - Income from House Property; BP - Income from Business & Profession; OS - Income from Other Sources; EI - Exempt Income
   */
  HeadOfIncome?: 'HP' | 'BP' | 'OS' | 'EI';
  TDSCreditCarriedFwd: number;
}
/**
 * This interface was referenced by `Itr4`'s JSON-Schema
 * via the `definition` "AddressDetail".
 */
export interface AddressDetail {
  AddrDetail: NonEmptyString;
  CityOrTownOrDistrict: NonEmptyString;
  /**
   * 01-Andaman and Nicobar islands; 02-Andhra Pradesh; 03-Arunachal Pradesh; 04-Assam; 05-Bihar; 06-Chandigarh; 07-Dadra Nagar and Haveli; 08-Daman and Diu; 09- Delhi; 10- Goa; 11-Gujarat; 12- Haryana; 13- Himachal Pradesh; 14-Jammu and Kashmir; 15- Karnataka; 16- Kerala; 17- Lakshadweep; 18-Madhya Pradesh; 19-Maharashtra; 20-Manipur; 21-meghalaya; 22-Mizoram; 23-Nagaland; 24- Odisha; 25- Puducherry; 26- Punjab; 27-Rajasthan; 28- Sikkim; 29-Tamil Nadu; 30- Tripura; 31-Uttar Pradesh; 32- West Bengal; 33- Chhattisgarh; 34- Uttarakhand; 35- Jharkhand; 36- Telangana; 37- Ladakh; 99- Foreign
   *
   * This interface was referenced by `Itr4`'s JSON-Schema
   * via the `definition` "StateCode".
   */
  StateCode: NonEmptyString & StateCode;
  PinCode: number;
}
