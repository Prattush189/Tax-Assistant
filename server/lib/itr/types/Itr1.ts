/* eslint-disable */
/**
 * Auto-generated from CBDT ITR JSON schema.
 * Do not edit manually — run `npm run itr:types` instead.
 */

/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "nonEmptyString".
 */
export type NonEmptyString = string;
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "nonZeroString".
 */
export type NonZeroString = EndWithDigit;
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "endWithDigit".
 */
export type EndWithDigit = string;

export interface Itr1 {
  ITR?: ITR;
}
/**
 * This is root node. Irrespective of Individual or bulk IT returns filed.
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "ITR".
 */
export interface ITR {
  ITR1: ITR1;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "ITR1".
 */
export interface ITR1 {
  CreationInfo: CreationInfo;
  Form_ITR1: Form_ITR1;
  PartA_139_8A?: PartA_139_8A;
  'PartB-ATI'?: PartBATI;
  PersonalInfo: PersonalInfo;
  FilingStatus: FilingStatus;
  ITR1_IncomeDeductions: ITR1_IncomeDeductions;
  ITR1_TaxComputation: ITR1_TaxComputation;
  TaxPaid: TaxPaid;
  Refund: Refund;
  Schedule80G?: Schedule80G;
  Schedule80GGA?: Schedule80GGA;
  Schedule80GGC?: Schedule80GGC;
  Schedule80D?: Schedule80D;
  Schedule80DD?: Schedule80DD;
  Schedule80U?: Schedule80U;
  Schedule80E?: Schedule80E;
  Schedule80EE?: Schedule80EE;
  Schedule80EEA?: Schedule80EEA;
  Schedule80EEB?: Schedule80EEB;
  Schedule80C?: Schedule80C;
  ScheduleUs24B?: ScheduleUs24B;
  ScheduleEA10_13A?: ScheduleEA10_13A;
  TDSonSalaries?: TDSonSalaries;
  TDSonOthThanSals?: TDSonOthThanSals;
  ScheduleTDS3Dtls?: ScheduleTDS3Dtls;
  ScheduleTCS?: ScheduleTCS;
  TaxPayments?: TaxPayments;
  LTCG112A?: LTCG112A;
  Verification: Verification;
  TaxReturnPreparer?: TaxReturnPreparer;
}
/**
 * This element will be used by third party vendors and intermediaries to give details of their software or JSON creation.
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This is the element identified for ITR-1, holding AY, Form and Schema version values.
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "Form_ITR1".
 */
export interface Form_ITR1 {
  FormName: NonEmptyString;
  Description: NonEmptyString;
  AssessmentYear: NonEmptyString;
  SchemaVer: NonEmptyString;
  FormVer: NonEmptyString;
}
/**
 * Enter personal information
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
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
   * ITR1 - ITR1
   */
  ITRFormUpdatingInc: NonEmptyString & 'ITR1';
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
   * CGOV:Central Government, SGOV:State Government, PSU:Public Sector Unit, PE:Pensioners - Central Government, PESG:Pensioners - State Government, PEPS:Pensioners - Public sector undertaking, PEO:Pensioners - Others, OTH:Others, NA:Not Applicable
   */
  EmployerCategory: 'CGOV' | 'SGOV' | 'PSU' | 'PE' | 'PESG' | 'PEPS' | 'PEO' | 'OTH' | 'NA';
  AadhaarCardNo?: NonEmptyString;
}
/**
 * Assessee name with Surname mandatory.
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "AssesseeName".
 */
export interface AssesseeName {
  FirstName?: NonEmptyString;
  MiddleName?: NonEmptyString;
  /**
   * Enter Last or Sur name for Individual name here
   */
  SurNameOrOrgName: NonEmptyString;
}
/**
 * Address of assessee
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "Address".
 */
export interface Address {
  ResidenceNo: NonEmptyString;
  ResidenceName?: NonEmptyString;
  RoadOrStreet?: NonEmptyString;
  LocalityOrArea: NonEmptyString;
  CityOrTownOrDistrict: NonEmptyString;
  /**
   * 01-Andaman and Nicobar islands; 02-Andhra Pradesh; 03-Arunachal Pradesh; 04-Assam; 05-Bihar; 06-Chandigarh; 07-Dadra Nagar and Haveli; 08-Daman and Diu; 09- Delhi; 10- Goa; 11-Gujarat; 12- Haryana; 13- Himachal Pradesh; 14-Jammu and Kashmir; 15- Karnataka; 16- Kerala; 17- Lakshadweep; 18-Madhya Pradesh; 19-Maharashtra; 20-Manipur; 21-meghalaya; 22-Mizoram; 23-Nagaland; 24- Odisha; 25- Puducherry; 26- Punjab; 27-Rajasthan; 28- Sikkim; 29-Tamil Nadu; 30- Tripura; 31-Uttar Pradesh; 32- West Bengal; 33- Chhattisgarh; 34- Uttarakhand; 35- Jharkhand; 36- Telangana; 37- Ladakh; 99-Foreign
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
      | '99'
    );
  /**
   * 93:AFGHANISTAN; 1001:ÅLAND ISLANDS; 355:ALBANIA; 213:ALGERIA; 684:AMERICAN SAMOA; 376:ANDORRA; 244:ANGOLA; 1264:ANGUILLA; 1010:ANTARCTICA; 1268:ANTIGUA AND BARBUDA; 54:ARGENTINA; 374:ARMENIA; 297:ARUBA; 61:AUSTRALIA; 43:AUSTRIA; 994:AZERBAIJAN; 1242:BAHAMAS; 973:BAHRAIN; 880:BANGLADESH; 1246:BARBADOS; 375:BELARUS; 32:BELGIUM; 501:BELIZE; 229:BENIN; 1441:BERMUDA; 975:BHUTAN; 591:BOLIVIA (PLURINATIONAL STATE OF); 1002:BONAIRE, SINT EUSTATIUS AND SABA; 387:BOSNIA AND HERZEGOVINA; 267:BOTSWANA; 1003:BOUVET ISLAND; 55:BRAZIL; 1014:BRITISH INDIAN OCEAN TERRITORY; 673:BRUNEI DARUSSALAM; 359:BULGARIA; 226: BURKINA FASO; 257:BURUNDI; 238:CABO VERDE; 855:CAMBODIA; 237:CAMEROON; 1:CANADA; 1345:CAYMAN ISLANDS; 236:CENTRAL AFRICAN REPUBLIC; 235:CHAD; 56:CHILE; 86:CHINA; 9:CHRISTMAS ISLAND; 672:COCOS (KEELING) ISLANDS; 57:COLOMBIA; 270:COMOROS; 242:CONGO; 243:CONGO (DEMOCRATIC REPUBLIC OF THE); 682:COOK ISLANDS; 506:COSTA RICA; 225:CÔTE D'IVOIRE; 385:CROATIA; 53:CUBA; 1015:CURAÇAO; 357:CYPRUS; 420:CZECHIA; 45:DENMARK; 253:DJIBOUTI; 1767:DOMINICA; 1809:DOMINICAN REPUBLIC; 593:ECUADOR; 20:EGYPT; 503:EL SALVADOR; 240:EQUATORIAL GUINEA; 291:ERITREA; 372:ESTONIA; 251:ETHIOPIA; 500:FALKLAND ISLANDS (MALVINAS); 298:FAROE ISLANDS; 679:FIJI; 358:FINLAND; 33:FRANCE; 594:FRENCH GUIANA; 689:FRENCH POLYNESIA; 1004:FRENCH SOUTHERN TERRITORIES; 241:GABON; 220:GAMBIA; 995:GEORGIA; 49:GERMANY; 233:GHANA; 350:GIBRALTAR; 30:GREECE; 299:GREENLAND; 1473:GRENADA; 590:GUADELOUPE; 1671:GUAM; 502:GUATEMALA; 1481:GUERNSEY; 224:GUINEA; 245:GUINEA-BISSAU; 592:GUYANA; 509:HAITI; 1005:HEARD ISLAND AND MCDONALD ISLANDS; 6:HOLY SEE; 504:HONDURAS; 852:HONG KONG; 36:HUNGARY; 354:ICELAND; 91:INDIA; 62:INDONESIA; 98:IRAN (ISLAMIC REPUBLIC OF); 964:IRAQ; 353:IRELAND; 1624:ISLE OF MAN; 972:ISRAEL; 5:ITALY; 1876:JAMAICA; 81:JAPAN; 1534:JERSEY; 962:JORDAN; 7:KAZAKHSTAN; 254:KENYA; 686:KIRIBATI; 850:KOREA(DEMOCRATIC PEOPLE'S REPUBLIC OF); 82:KOREA (REPUBLIC OF); 965:KUWAIT; 996:KYRGYZSTAN; 856:LAO PEOPLE'S DEMOCRATIC REPUBLIC; 371:LATVIA; 961:LEBANON; 266:LESOTHO; 231:LIBERIA; 218:LIBYA; 423:LIECHTENSTEIN; 370:LITHUANIA; 352:LUXEMBOURG; 853:MACAO; 389:MACEDONIA(THE FORMER YUGOSLAV REPUBLIC OF); 261:MADAGASCAR; 265:MALAWI; 60:MALAYSIA; 960:MALDIVES; 223:MALI; 356:MALTA; 692:MARSHALL ISLANDS; 596:MARTINIQUE; 222:MAURITANIA; 230:MAURITIUS; 269:MAYOTTE; 52:MEXICO; 691:MICRONESIA (FEDERATED STATES OF); 373:MOLDOVA (REPUBLIC OF); 377:MONACO; 976:MONGOLIA; 382:MONTENEGRO; 1664:MONTSERRAT; 212:MOROCCO; 258:MOZAMBIQUE; 95:MYANMAR; 264:NAMIBIA; 674:NAURU; 977:NEPAL; 31:NETHERLANDS; 687:NEW CALEDONIA; 64:NEW ZEALAND; 505:NICARAGUA; 227:NIGER; 234:NIGERIA; 683:NIUE; 15:NORFOLK ISLAND; 1670:NORTHERN MARIANA ISLANDS; 47:NORWAY; 968:OMAN; 92:PAKISTAN; 680:PALAU; 970:PALESTINE, STATE OF; 507:PANAMA; 675:PAPUA NEW GUINEA; 595:PARAGUAY; 51:PERU; 63:PHILIPPINES; 1011:PITCAIRN; 48:POLAND; 14:PORTUGAL; 1787:PUERTO RICO; 974:QATAR; 262:RÉUNION; 40:ROMANIA; 8:RUSSIAN FEDERATION; 250:RWANDA; 1006:SAINT BARTHÉLEMY; 290: SAINT HELENA, ASCENSION AND TRISTAN DA CUNHA; 1869:SAINT KITTS AND NEVIS; 1758:SAINT LUCIA; 1007:SAINT MARTIN (FRENCH PART); 508:SAINT PIERRE AND MIQUELON; 1784:SAINT VINCENT AND THE GRENADINES; 685:SAMOA; 378:SAN MARINO; 239:SAO TOME AND PRINCIPE; 966:SAUDI ARABIA; 221:SENEGAL; 381:SERBIA; 248:SEYCHELLES; 232:SIERRA LEONE; 65:SINGAPORE; 1721:SINT MAARTEN (DUTCH PART); 421:SLOVAKIA; 386:SLOVENIA; 677:SOLOMON ISLANDS; 252:SOMALIA; 28:SOUTH AFRICA; 1008:SOUTH GEORGIA AND THE SOUTH SANDWICH ISLANDS; 211:SOUTH SUDAN; 35:SPAIN; 94:SRI LANKA; 249:SUDAN; 597:SURINAME; 1012:SVALBARD AND JAN MAYEN; 268:SWAZILAND; 46:SWEDEN; 41:SWITZERLAND; 963:SYRIAN ARAB REPUBLIC; 886:TAIWAN; 992:TAJIKISTAN; 255:TANZANIA, UNITED REPUBLIC OF; 66:THAILAND; 670:TIMOR-LESTE (EAST TIMOR); 228:TOGO; 690:TOKELAU; 676:TONGA; 1868:TRINIDAD AND TOBAGO; 216:TUNISIA; 90:TURKEY; 993:TURKMENISTAN; 1649:TURKS AND CAICOS ISLANDS; 688:TUVALU; 256:UGANDA; 380:UKRAINE; 971:UNITED ARAB EMIRATES; 44:UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND; 2:UNITED STATES OF AMERICA; 1009:UNITED STATES MINOR OUTLYING ISLANDS; 598:URUGUAY; 998:UZBEKISTAN; 678:VANUATU; 58:VENEZUELA (BOLIVARIAN REPUBLIC OF); 84:VIET NAM; 1284:VIRGIN ISLANDS (BRITISH); 1340:VIRGIN ISLANDS (U.S.); 681:WALLIS AND FUTUNA; 1013:WESTERN SAHARA; 967:YEMEN; 260:ZAMBIA; 263:ZIMBABWE; 9999:OTHERS
   *
   * This interface was referenced by `Itr1`'s JSON-Schema
   * via the `definition` "CountryCode".
   */
  CountryCode: NonEmptyString & CountryCode;
  PinCode?: number;
  ZipCode?: NonEmptyString;
  CountryCodeMobile: number;
  MobileNo: number;
  EmailAddress: NonEmptyString;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "FilingStatus".
 */
export interface FilingStatus {
  /**
   * 11 : 139(1)-On or before due date, 12 : 139(4)-After due date, 13 : 142(1), 14 : 148,  16 : 153C, 17 : 139(5)-Revised , 18 : 139(9), 20 : 119(2)(b)-After condonation of delay, 21 : 139(8A)-Updated Return
   */
  ReturnFileSec: 11 | 12 | 13 | 14 | 16 | 17 | 18 | 20 | 21;
  OptOutNewTaxRegime: NonEmptyString;
  SeventhProvisio139?: NonEmptyString;
  IncrExpAggAmt2LkTrvFrgnCntryFlg?: NonEmptyString;
  AmtSeventhProvisio139ii?: number;
  IncrExpAggAmt1LkElctrctyPrYrFlg?: NonEmptyString;
  AmtSeventhProvisio139iii?: number;
  clauseiv7provisio139i?: NonEmptyString;
  clauseiv7provisio139iDtls?: Clauseiv7Provisio139IType[];
  /**
   * Enter the Acknowledgement number of the original return.
   */
  ReceiptNo?: string;
  NoticeNo?: NonEmptyString;
  /**
   * Enter Date of filing of Original return in YYYY-MM-DD format
   */
  OrigRetFiledDate?: string;
  /**
   * Enter Date of Notice or Order in YYYY-MM-DD format
   */
  NoticeDateUnderSec?: string;
  ItrFilingDueDate: NonEmptyString;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "clauseiv7provisio139iType".
 */
export interface Clauseiv7Provisio139IType {
  /**
   * 1 - the aggregate of tax deducted at source and tax collected at source during the previous year, in the case of the person, is twenty-five thousand rupees or more(fifty thousand for resident senior citizen); 2 - the deposit in one or more savings bank account of the person, in aggregate, is fifty lakh rupees or more, in the previous year
   */
  clauseiv7provisio139iNature: '1' | '2';
  clauseiv7provisio139iAmount: number;
}
/**
 * Income and deduction details
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "ITR1_IncomeDeductions".
 */
export interface ITR1_IncomeDeductions {
  GrossSalary: number;
  Salary?: number;
  PerquisitesValue?: number;
  ProfitsInSalary?: number;
  IncomeNotified89A: number;
  IncomeNotified89AType?: NOT89AType[];
  IncomeNotifiedOther89A?: number;
  AllwncExemptUs10?: {
    AllwncExemptUs10Dtls?: AllwncExemptUs10DtlsType[];
    TotalAllwncExemptUs10: number;
  };
  Increliefus89A?: number;
  NetSalary: number;
  DeductionUs16: number;
  DeductionUs16ia?: number;
  EntertainmentAlw16ii?: number;
  ProfessionalTaxUs16iii?: number;
  IncomeFromSal: number;
  /**
   * House Property income Type - S:Self Occupied; L:Let Out; D:Deemed let out
   */
  TypeOfHP?: NonEmptyString;
  GrossRentReceived?: number;
  TaxPaidlocalAuth?: number;
  AnnualValue: number;
  /**
   * This field refers to Part-B B2 iv - 30% of Annual Value
   */
  StandardDeduction: number;
  InterestPayable?: number;
  ArrearsUnrealizedRentRcvd?: number;
  /**
   * House Property income
   */
  TotalIncomeOfHP: number;
  IncomeOthSrc: number;
  OthersInc?: {
    OthersIncDtlsOthSrc?: OtherSourceIncome[];
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
  ExemptIncAgriOthUs10?: {
    ExemptIncAgriOthUs10Dtls?: ExemptIncAgriOthUs10Type[];
    ExemptIncAgriOthUs10Total: number;
  };
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "AllwncExemptUs10DtlsType".
 */
export interface AllwncExemptUs10DtlsType {
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
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "OtherSourceIncome".
 */
export interface OtherSourceIncome {
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
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
   * 1 : Self or dependent ; 2 : Self or Dependent - Senior Citizen
   */
  Section80DDBUsrType?: NonEmptyString & ('1' | '2');
  /**
   * a : Dementia; b : Dystonia Musculorum Deformans; c : Motor Neuron Disease; d : Ataxia; e : Chorea; f : Hemiballismus; g : Aphasia; h: Parkinsons Disease; i : Malignant Cancers; j : Full Blown Acquired Immuno-Deficiency Syndrome (AIDS); k:Chronic Renal failure; l:Hematological disorders; m: Hemophilia; n:Thalassaemia
   */
  NameOfSpecDisease80DDB?: NonEmptyString &
    ('a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n');
  Section80DDB: number;
  Section80E: number;
  Section80EE: number;
  Section80EEA?: number;
  Section80EEB?: number;
  Section80G: number;
  Section80GG: number;
  Form10BAAckNum?: string;
  Section80GGA: number;
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
  Section80EE: number;
  Section80EEA: number;
  Section80EEB: number;
  Section80G: number;
  Section80GG: number;
  Section80GGA: number;
  Section80GGC: number;
  Section80U: number;
  Section80TTA: number;
  Section80TTB: number;
  AnyOthSec80CCH: number;
  TotalChapVIADeductions: number;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "ExemptIncAgriOthUs10Type".
 */
export interface ExemptIncAgriOthUs10Type {
  /**
   * AGRI : Agriculture Income (<= Rs.5000); 10(10BC): Sec 10(10BC)-Any amount from the Central/State Govt./local authority by way of compensation on account of any disaster; 10(10D) : Sec 10(10D)- Any sum received under a life insurance policy, including the sum allocated by way of bonus on such policy except sum as mentioned in sub-clause (a) to (d) of Sec.10(10D); 10(11) : Sec 10(11)-Statuory Provident Fund received; 10(12) : Sec 10(12)-Recognised Provident Fund received;10(12C) : Sec 10(12C)-Any payment from the Agniveer Corpus Fund to a person enrolled under the Agnipath Scheme, or to his nominee.; 10(13) : Sec 10(13)-Approved superannuation fund received; 10(16) : Sec 10(16)-Scholarships granted to meet the cost of education; 10(17) : Sec 10(17)-Allowance MP/MLA/MLC; 10(17A) : Sec 10(17A)-Award instituted by Government; 10(18) : Sec 10(18)-Pension received by winner of "Param Vir Chakra" or "Maha Vir Chakra" or "Vir Chakra" or such other gallantry award; DMDP : Defense medical disability pension; 10(19) : Sec 10(19)-Armed Forces Family pension in case of death during operational duty; 10(26) : Sec 10(26)-Any income as referred to in section 10(26); 10(26AAA): Sec 10(26AAA)-Any income as referred to in section 10(26AAA) ; OTH : Any Other
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
 * Tax computation details
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "ITR1_TaxComputation".
 */
export interface ITR1_TaxComputation {
  TotalTaxPayable: number;
  Rebate87A: number;
  TaxPayableOnRebate: number;
  EducationCess: number;
  GrossTaxLiability: number;
  Section89: number;
  /**
   * Balance Tax After Relief
   */
  NetTaxLiability: number;
  TotalIntrstPay: number;
  IntrstPay: IntrstPay;
  TotTaxPlusIntrstPay: number;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "TaxPaid".
 */
export interface TaxPaid {
  TaxesPaid: TaxesPaid;
  BalTaxPayable: number;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "TaxesPaid".
 */
export interface TaxesPaid {
  AdvanceTax: number;
  TDS: number;
  TCS: number;
  SelfAssessmentTax: number;
  TotalTaxesPaid: number;
}
/**
 * Refund details
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "BankAccountDtls".
 */
export interface BankAccountDtls {
  /**
   * @minItems 1
   */
  AddtnlBankDetails?: [BankDetailType, ...BankDetailType[]];
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "DoneeWithPan".
 */
export interface DoneeWithPan {
  DoneeWithPanName: NonEmptyString;
  DoneePAN: NonEmptyString;
  /**
   * Please enter ARN (Donation reference Number)
   */
  ArnNbr?: NonEmptyString;
  AddressDetail: AddressDetail;
  DonationAmtCash: number;
  DonationAmtOtherMode: number;
  DonationAmt: number;
  EligibleDonationAmt: number;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "AddressDetail".
 */
export interface AddressDetail {
  AddrDetail: NonEmptyString;
  CityOrTownOrDistrict: NonEmptyString;
  /**
   * 01-Andaman and Nicobar islands; 02-Andhra Pradesh; 03-Arunachal Pradesh; 04-Assam; 05-Bihar; 06-Chandigarh; 07-Dadra Nagar and Haveli; 08-Daman and Diu; 09- Delhi; 10- Goa; 11-Gujarat; 12- Haryana; 13- Himachal Pradesh; 14-Jammu and Kashmir; 15- Karnataka; 16- Kerala; 17- Lakshadweep; 18-Madhya Pradesh; 19-Maharashtra; 20-Manipur; 21-meghalaya; 22-Mizoram; 23-Nagaland; 24- Odisha; 25- Puducherry; 26- Punjab; 27-Rajasthan; 28- Sikkim; 29-Tamil Nadu; 30- Tripura; 31-Uttar Pradesh; 32- West Bengal; 33- Chhattisgarh; 34- Uttarakhand; 35- Jharkhand; 36- Telangana; 37- Ladakh
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "Schedule80GGA".
 */
export interface Schedule80GGA {
  DonationDtlsSciRsrchRuralDev?: {
    /**
     * 80GGA(2)(a) - Sum paid to Research Association or University, college or other institution for Scientific Research; 80GGA(2)(aa) - Sum paid to Research Association or University, college or other institution for Social science or Statistical Research; 80GGA(2)(b) - Sum paid to an association or institution for Rural Development; 80GGA(2)(bb) - Sum paid to PSU or Local Authority or an association or institution approved by the National Committee for carrying out any eligible project; 80GGA(2)(c) - Sum paid to an association or institution for Conservation of Natural Resources or for afforestation; 80GGA(2)(cc) - Sum paid for Afforestation, to the funds, which are notified by Central Govt.; 80GGA(2)(d) - Sum paid for Rural Development to the funds, which are notified by Central Govt.; 80GGA(2)(e) - Sum paid to National Urban Poverty Eradication Fund as setup and notified by Central Govt.
     */
    RelevantClauseUndrDedClaimed:
      | '80GGA2a'
      | '80GGA2aa'
      | '80GGA2b'
      | '80GGA2bb'
      | '80GGA2c'
      | '80GGA2cc'
      | '80GGA2d'
      | '80GGA2e';
    NameOfDonee: NonEmptyString;
    AddressDetail: AddressDetail;
    DoneePAN: NonEmptyString;
    DonationAmtCash: number;
    DonationAmtOtherMode: number;
    DonationAmt: number;
    EligibleDonationAmt: number;
  }[];
  TotalDonationAmtCash80GGA: number;
  TotalDonationAmtOtherMode80GGA: number;
  TotalDonationsUs80GGA: number;
  TotalEligibleDonationAmt80GGA: number;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "Schedule80D".
 */
export interface Schedule80D {
  Sec80DSelfFamSrCtznHealth: {
    /**
     * Y - Yes; N - No; S - Not claiming for Self/ Family
     */
    SeniorCitizenFlag: NonEmptyString;
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
    ParentsSeniorCitizenFlag: NonEmptyString;
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "Sch80DInsDtls".
 */
export interface Sch80DInsDtls {
  InsurerName: string;
  PolicyNo: string;
  HealthInsAmt: number;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "Schedule80DD".
 */
export interface Schedule80DD {
  /**
   * 1 : Dependent person with disability  ; 2 : Dependent person with severe disability
   */
  NatureOfDisability: NonEmptyString & ('1' | '2');
  /**
   * 1 : autism, cerebral palsy, or multiple disabilities; 2 : others;
   */
  TypeOfDisability: NonEmptyString & ('1' | '2');
  DeductionAmount: number;
  /**
   * 1. Spouse; 2. Son; 3. Daughter; 4. Father; 5. Mother; 6. Brother; 7. Sister;
   */
  DependentType: NonEmptyString & ('1' | '2' | '3' | '4' | '5' | '6' | '7');
  DependentPan?: NonEmptyString;
  DependentAadhaar?: NonEmptyString;
  Form10IAAckNum?: string;
  UDIDNum?: string;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "Schedule80U".
 */
export interface Schedule80U {
  /**
   * 1 : Self with disability  ; 2 : Self with severe disability
   */
  NatureOfDisability: NonEmptyString & ('1' | '2');
  /**
   * 1 : autism, cerebral palsy, or multiple disabilities; 2 : others;
   */
  TypeOfDisability: NonEmptyString & ('1' | '2');
  DeductionAmount: number;
  Form10IAAckNum?: string;
  UDIDNum?: string;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * Salary TDS details
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "TDSonSalary".
 */
export interface TDSonSalary {
  EmployerOrDeductorOrCollectDetl: EmployerOrDeductorOrCollectDetl;
  IncChrgSal: number;
  TotalTDSSal: number;
}
/**
 * Dedcutor Details
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "EmployerOrDeductorOrCollectDetl".
 */
export interface EmployerOrDeductorOrCollectDetl {
  TAN: NonEmptyString;
  EmployerOrDeductorOrCollecterName: NonEmptyString;
}
/**
 * 22. Details of Tax Deducted at Source on Interest [As per Form 16 A issued by Deductor(s)]
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "TDSonOthThanSals".
 */
export interface TDSonOthThanSals {
  /**
   * @minItems 1
   */
  TDSonOthThanSal?: [TDSonOthThanSal, ...TDSonOthThanSal[]];
  TotalTDSonOthThanSals: number;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "TDSonOthThanSal".
 */
export interface TDSonOthThanSal {
  EmployerOrDeductorOrCollectDetl: EmployerOrDeductorOrCollectDetl;
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
  AmtForTaxDeduct: number;
  /**
   * 2024: 2024-25; 2023: 2023-24; 2022: 2022-23; 2021: 2021-22; 2020: 2020-21; 2019: 2019-20; 2018: 2018-19; 2017: 2017-18; 2016: 2016-17; 2015: 2015-16; 2014: 2014-15; 2013: 2013-14; 2012: 2012-13; 2011: 2011-12; 2010: 2010-11; 2009: 2009-10; 2008: 2008-09
   */
  DeductedYr: NonEmptyString &
    (
      | '2024'
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
  TotTDSOnAmtPaid: number;
  ClaimOutOfTotTDSOnAmtPaid: number;
}
/**
 * Details of Tax Deducted at Source [16C furnished by the Deductor(s)]
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "TDS3Details".
 */
export interface TDS3Details {
  PANofTenant: NonEmptyString;
  AadhaarofTenant?: NonEmptyString;
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
  NameOfTenant: NonEmptyString;
  GrsRcptToTaxDeduct: number;
  /**
   * 2024:2024-25; 2023:2023-24; 2022:2022-23; 2021:2021-22; 2020:2020-21; 2019:2019-20; 2018:2018-19; 2017:2017-18;
   */
  DeductedYr: NonEmptyString & ('2024' | '2023' | '2022' | '2021' | '2020' | '2019' | '2018' | '2017');
  TDSDeducted: number;
  TDSClaimed: number;
}
/**
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "ScheduleTCS".
 */
export interface ScheduleTCS {
  /**
   * @minItems 1
   */
  TCS?: [
    {
      EmployerOrDeductorOrCollectDetl: EmployerOrDeductorOrCollectDetl;
      AmtTaxCollected: number;
      /**
       *  2024: 2024-25; 2023: 2023-24; 2022: 2022-23; 2021: 2021-22; 2020: 2020-21; 2019: 2019-20; 2018: 2018-19; 2017: 2017-18; 2016: 2016-17; 2015: 2015-16; 2014: 2014-15; 2013: 2013-14; 2012: 2012-13; 2011: 2011-12; 2010: 2010-11; 2009: 2009-10; 2008: 2008-09
       */
      CollectedYr:
        | '2024'
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
        | '2008';
      TotalTCS: number;
      /**
       * Amount out of (5) claimed for this year
       */
      AmtTCSClaimedThisYear: number;
    },
    ...{
      EmployerOrDeductorOrCollectDetl: EmployerOrDeductorOrCollectDetl;
      AmtTaxCollected: number;
      /**
       *  2024: 2024-25; 2023: 2023-24; 2022: 2022-23; 2021: 2021-22; 2020: 2020-21; 2019: 2019-20; 2018: 2018-19; 2017: 2017-18; 2016: 2016-17; 2015: 2015-16; 2014: 2014-15; 2013: 2013-14; 2012: 2012-13; 2011: 2011-12; 2010: 2010-11; 2009: 2009-10; 2008: 2008-09
       */
      CollectedYr:
        | '2024'
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
        | '2008';
      TotalTCS: number;
      /**
       * Amount out of (5) claimed for this year
       */
      AmtTCSClaimedThisYear: number;
    }[]
  ];
  TotalSchTCS: number;
}
/**
 * Tax payment details
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "TaxPayments".
 */
export interface TaxPayments {
  /**
   * @minItems 1
   */
  TaxPayment?: [TaxPayment, ...TaxPayment[]];
  TotalTaxPayments: number;
}
/**
 * Tax payment detail
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * Long Term capital gains u/s 112A
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
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
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "Verification".
 */
export interface Verification {
  Declaration: {
    AssesseeVerName: NonEmptyString;
    FatherName: NonEmptyString;
    AssesseeVerPAN: NonEmptyString;
  };
  /**
   * S : Self ; R : Representative
   */
  Capacity: 'S' | 'R';
  Place: NonEmptyString;
}
/**
 * TRP details
 *
 * This interface was referenced by `Itr1`'s JSON-Schema
 * via the `definition` "TaxReturnPreparer".
 */
export interface TaxReturnPreparer {
  IdentificationNoOfTRP: NonEmptyString;
  NameOfTRP: NonEmptyString;
  ReImbFrmGov?: number;
}
