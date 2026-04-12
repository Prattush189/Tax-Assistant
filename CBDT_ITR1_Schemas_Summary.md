# CBDT ITR-1 JSON Schema Definitions

## Complete Schema Set for ITR-1 Schedules and Deductions

## DeductUndChapVIAType
Description: Deductions from income
Type: object
Required fields: Section80C, Section80CCC, Section80CCDEmployeeOrSE, Section80CCD1B, Section80CCDEmployer, Section80D, Section80DD, Section80DDB, Section80E, Section80EE, Section80EEA, Section80EEB, Section80G, Section80GG, Section80GGA, Section80GGC, Section80U, Section80TTA, Section80TTB, AnyOthSec80CCH, TotalChapVIADeductions
Properties:
  - Section80C: integer
    (min: 0)    (max: 150000)
  - Section80CCC: integer
    (min: 0)    (max: 150000)
  - Section80CCDEmployeeOrSE: integer - For Employee/SelfEmployed
    (min: 0)    (max: 150000)
  - Section80CCD1B: integer
    (min: 0)    (max: 50000)
  - Section80CCDEmployer: integer
    (min: 0)    (max: 99999999999999)
  - Section80D: integer
    (min: 0)    (max: 100000)
  - Section80DD: integer
    (min: 0)    (max: 125000)
  - Section80DDB: integer
    (min: 0)    (max: 100000)
  - Section80E: integer
    (min: 0)    (max: 99999999999999)
  - Section80EE: integer
    (min: 0)    (max: 50000)
  - Section80EEA: integer
    (min: 0)    (max: 150000)
  - Section80EEB: integer
    (min: 0)    (max: 150000)
  - Section80G: integer
    (min: 0)    (max: 99999999999999)
  - Section80GG: integer
    (min: 0)    (max: 60000)
  - Section80GGA: integer
    (min: 0)    (max: 99999999999999)
  - Section80GGC: integer
    (min: 0)    (max: 99999999999999)
  - Section80U: integer
    (min: 0)    (max: 125000)
  - Section80TTA: integer
    (min: 0)    (max: 10000)
  - Section80TTB: integer
    (min: 0)    (max: 50000)
  - AnyOthSec80CCH: integer
    (min: 0)    (max: 288000)
  - TotalChapVIADeductions: integer
    (min: 0)    (max: 99999999999999)

---

## DoneeWithPan
Type: object
Required fields: DoneeWithPanName, DoneePAN, AddressDetail, DonationAmtCash, DonationAmtOtherMode, DonationAmt, EligibleDonationAmt
Properties:
  - DoneeWithPanName: 
  - DoneePAN: 
  - ArnNbr:  - Please enter ARN (Donation reference Number)
  - AddressDetail: (ref: #/definitions/AddressDetail)
  - DonationAmtCash: integer
    (min: 0)    (max: 99999999999999)
  - DonationAmtOtherMode: integer
    (min: 0)    (max: 99999999999999)
  - DonationAmt: integer
    (min: 0)    (max: 99999999999999)
  - EligibleDonationAmt: integer
    (min: 0)    (max: 99999999999999)

---

## EmployerOrDeductorOrCollectDetl
Description: Dedcutor Details
Type: object
Required fields: TAN, EmployerOrDeductorOrCollecterName
Properties:
  - TAN: 
  - EmployerOrDeductorOrCollecterName: 

---

## ExemptIncAgriOthUs10Type
Type: object
Required fields: NatureDesc, OthAmount
Properties:
  - NatureDesc:  - AGRI : Agriculture Income (<= Rs.5000); 10(10BC): Sec 10(10BC)-Any amount from the Central/State Govt./local authority by way of compensation on account of any disaster; 10(10D) : Sec 10(10D)- Any sum received under a life insurance policy, including the sum allocated by way of bonus on such policy except sum as mentioned in sub-clause (a) to (d) of Sec.10(10D); 10(11) : Sec 10(11)-Statuory Provident Fund received; 10(12) : Sec 10(12)-Recognised Provident Fund received;10(12C) : Sec 10(12C)-Any payment from the Agniveer Corpus Fund to a person enrolled under the Agnipath Scheme, or to his nominee.; 10(13) : Sec 10(13)-Approved superannuation fund received; 10(16) : Sec 10(16)-Scholarships granted to meet the cost of education; 10(17) : Sec 10(17)-Allowance MP/MLA/MLC; 10(17A) : Sec 10(17A)-Award instituted by Government; 10(18) : Sec 10(18)-Pension received by winner of "Param Vir Chakra" or "Maha Vir Chakra" or "Vir Chakra" or such other gallantry award; DMDP : Defense medical disability pension; 10(19) : Sec 10(19)-Armed Forces Family pension in case of death during operational duty; 10(26) : Sec 10(26)-Any income as referred to in section 10(26); 10(26AAA): Sec 10(26AAA)-Any income as referred to in section 10(26AAA) ; OTH : Any Other
  - OthNatOfInc: 
  - OthAmount: integer
    (min: 0)    (max: 99999999999999)

---

## NOT89AType
Type: object
Required fields: NOT89ACountrycode, NOT89AAmount
Properties:
  - NOT89ACountrycode: string - US - United States; UK - United Kingdom; CA - Canada
  - NOT89AAmount: integer
    (min: 0)    (max: 99999999999999)

---

## Sch80DInsDtls
Type: object
Required fields: InsurerName, PolicyNo, HealthInsAmt
Properties:
  - InsurerName: string
  - PolicyNo: string
  - HealthInsAmt: integer
    (min: 0)    (max: 99999999999999)

---

## Schedule80C
Type: object
Required fields: Schedule80CDtls, TotalAmt
Properties:
  - Schedule80CDtls: array
  - TotalAmt: integer
    (min: 0)    (max: 99999999999999)

---

## Schedule80D
Type: object
Required fields: Sec80DSelfFamSrCtznHealth
Properties:
  - Sec80DSelfFamSrCtznHealth: object

---

## Schedule80DD
Type: object
Required fields: NatureOfDisability, TypeOfDisability, DeductionAmount, DependentType
Properties:
  - NatureOfDisability:  - 1 : Dependent person with disability  ; 2 : Dependent person with severe disability
  - TypeOfDisability:  - 1 : autism, cerebral palsy, or multiple disabilities; 2 : others;
  - DeductionAmount: integer
    (min: 0)    (max: 99999999999999)
  - DependentType:  - 1. Spouse; 2. Son; 3. Daughter; 4. Father; 5. Mother; 6. Brother; 7. Sister;
  - DependentPan: 
  - DependentAadhaar: 
  - Form10IAAckNum: string
  - UDIDNum: string

---

## Schedule80E
Type: object
Required fields: Schedule80EDtls, TotalInterest80E
Properties:
  - Schedule80EDtls: array
  - TotalInterest80E: integer
    (min: 0)    (max: 99999999999999)

---

## Schedule80EE
Type: object
Required fields: Schedule80EEDtls, TotalInterest80EE
Properties:
  - Schedule80EEDtls: array
  - TotalInterest80EE: integer
    (min: 0)    (max: 99999999999999)

---

## Schedule80EEA
Type: object
Required fields: PropStmpDtyVal, Schedule80EEADtls, TotalInterest80EEA
Properties:
  - PropStmpDtyVal: integer
    (min: 0)    (max: 4500000)
  - Schedule80EEADtls: array
  - TotalInterest80EEA: integer
    (min: 0)    (max: 99999999999999)

---

## Schedule80EEB
Type: object
Required fields: Schedule80EEBDtls, TotalInterest80EEB
Properties:
  - Schedule80EEBDtls: array
  - TotalInterest80EEB: integer
    (min: 0)    (max: 99999999999999)

---

## Schedule80G
Type: object
Required fields: TotalDonationsUs80GCash, TotalDonationsUs80GOtherMode, TotalDonationsUs80G, TotalEligibleDonationsUs80G
Properties:
  - Don100Percent: object
  - Don50PercentNoApprReqd: object
  - Don100PercentApprReqd: object
  - Don50PercentApprReqd: object
  - TotalDonationsUs80GCash: integer
    (min: 0)    (max: 99999999999999)
  - TotalDonationsUs80GOtherMode: integer
    (min: 0)    (max: 99999999999999)
  - TotalDonationsUs80G: integer
    (min: 0)    (max: 99999999999999)
  - TotalEligibleDonationsUs80G: integer
    (min: 0)    (max: 99999999999999)

---

## Schedule80U
Type: object
Required fields: NatureOfDisability, TypeOfDisability, DeductionAmount
Properties:
  - NatureOfDisability:  - 1 : Self with disability  ; 2 : Self with severe disability
  - TypeOfDisability:  - 1 : autism, cerebral palsy, or multiple disabilities; 2 : others;
  - DeductionAmount: integer
    (min: 0)    (max: 99999999999999)
  - Form10IAAckNum: string
  - UDIDNum: string

---

## ScheduleEA10_13A
Type: object
Required fields: Placeofwork, ActlHRARecv, ActlRentPaid, DtlsSalUsSec171, BasicSalary, ActlRentPaid10Per, Sal40Or50Per, EligbleExmpAllwncUs13A
Properties:
  - Placeofwork: string - 1: Metro, 2: Non-Metro
  - ActlHRARecv: integer
    (min: 0)    (max: 99999999999999)
  - ActlRentPaid: integer
    (min: 0)    (max: 99999999999999)
  - DtlsSalUsSec171: integer
    (min: 0)    (max: 99999999999999)
  - BasicSalary: integer
    (min: 0)    (max: 99999999999999)
  - DearnessAllwnc: integer
    (min: 0)    (max: 99999999999999)
  - ActlRentPaid10Per: integer
    (min: 0)    (max: 99999999999999)
  - Sal40Or50Per: integer
    (min: 0)    (max: 99999999999999)
  - EligbleExmpAllwncUs13A: integer
    (min: 0)    (max: 99999999999999)

---

## ScheduleTCS
Type: object
Required fields: TotalSchTCS
Properties:
  - TCS: array
  - TotalSchTCS: integer
    (min: 0)    (max: 99999999999999)

---

## ScheduleTDS3Dtls
Description: Details of Tax Deducted at Source [16C furnished by the Deductor(s)]
Type: object
Required fields: TotalTDS3Details
Properties:
  - TDS3Details: array
  - TotalTDS3Details: integer
    (min: 0)    (max: 99999999999999)

---

## ScheduleUs24B
Type: object
Required fields: ScheduleUs24BDtls, TotalInterestUs24B
Properties:
  - ScheduleUs24BDtls: array
  - TotalInterestUs24B: integer
    (min: 0)    (max: 99999999999999)

---

## TDS3Details
Type: object
Required fields: PANofTenant, NameOfTenant, GrsRcptToTaxDeduct, DeductedYr, TDSDeducted, TDSClaimed, TDSSection
Properties:
  - PANofTenant: 
  - AadhaarofTenant: 
  - TDSSection:  - 92A:192- Salary-Payment to Government employees other than Indian Government employees; 92B:192- Salary-Payment to employees other than Government employees; 92C:192- Salary-Payment to Indian Government employees; 192A:192A/2AA- TDS on PF withdrawal; 193:193- Interest on Securities; 194:194- Dividends; 94A:194A- Interest other than 'Interest on securities'; 94B:194B- Winning from lottery or crossword puzzle; 94BA:194BA- Winnings from online games; 4BB:194BB- Winning from horse race; 94C:194C- Payments to contractors and sub-contractors; 94D:194D- Insurance commission; 4DA:194DA- Payment in respect of life insurance policy; 94E:194E- Payments to non-resident sportsmen or sports associations; 4EE:194EE- Payments in respect of deposits under National Savings; 4F:194F/94F- Payments on account of repurchase of units by Mutual Fund or Unit Trust of India; 4G:194G/94G- Commission, price, etc. on sale of lottery tickets; 4H:194H/94H- Commission or brokerage; 4-IA:194I(a)/4IA- Rent on hiring of plant and machinery;  4-IB:194I(b)/4IB - Rent on other than plant and machinery; 4IA:194IA/9IA- TDS on Sale of immovable property; 4IB:194IB/9IB- Payment of rent by certain individuals or Hindu undivided; 4IC:194IC- Payment under specified agreement; 94J-A:194J(a)/4JA - Fees for technical services; 94J-B:194J(b)/4JB- Fees for professional  services or royalty etc; 94K:194K- Income payable to a resident assessee in respect of units of a specified mutual fund or of the units of the Unit Trust of India; 4LA:194LA- Payment of compensation on acquisition of certain immovable; 4LB:194LB- Income by way of Interest from Infrastructure Debt fund; 4LC1:194LC/LC1- 194LC (2)(i) and (ia) Income under clause (i) and (ia) of sub-section (2) of section 194LC; 4LC2:194LC/LC2- 194LC (2)(ib) Income under clause (ib) of sub-section (2) of section 194LC; 4LC3:194LC/LC3- 194LC (2)(ic) Income under clause (ic) of sub-section (2) of section 194LC; 4BA1:194LBA(a)/BA1- Certain income in the form of interest from units of a business trust to a resident unit holder; 4BA2: 194LBA(b)/BA2- Certain income in the form of dividend from units of a business trust to a resident unit holder; LBA1:194LBA(a)/BA1- 194LBA(a) income referred to in section 10(23FC)(a) from units of a business trust-NR; LBA2:194LBA(b)/BA2-194LBA(b) Income referred to in section 10(23FC)(b) from units of a business trust-NR; LBA3:194LBA(c)/BA3- 194LBA(c) Income referred to in section 10(23FCA) from units of a business trust-NR; LBB: 194LBB- Income in respect of units of investment fund; 94R:194R- Benefits or perquisites of business or profession; 94S:194S- Payment of consideration for transfer of virtual digital asset by persons other than specified persons; 94B-P:Proviso to section 194B/4BP- Winnings from lotteries and crossword puzzles where consideration is made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such winnings are released; 94R-P: First Proviso to sub-section(1) of section 194R/4RP- Benefits or perquisites of business or profession where such benefit is provided in kind or where part in cash is not sufficient to meet tax liability and tax required to be deducted is paid before such benefit is released; 94S-P:Proviso to sub- section(1) of section 194S/4SP- Payment for transfer of virtual digital asset where payment is in kind or in exchange of another virtual digital asset and tax required to be deducted is paid before such payment is released; LBC:194LBC- Income in respect of investment in securitization trust; 4LD:194LD- TDS on interest on bonds / government securities; 94M:194M- Payment of certain sums by certain individuals or HUF; 94N:194N- Payment of certain amounts in cash other than cases covered by first proviso or third proviso; 94N-F: 194N/4NF -First Proviso Payment of certain amounts in cash to non-filers except in case of co-operativesocieties; 94N-C:194N/4NC- Third Proviso Payment of certain amounts in cash to co-operative societies not covered by first proviso; 94N-FT: 194N/NFT- First Proviso read with Third Proviso Payment of certain amount in cash to non-filers being co-operative societies; 94O:194O- Payment of certain sums by e-commerce operator to e-commerce participant.; 94P: 194P- Deduction of tax in case of specified senior citizen; 94Q:194Q- Deduction of tax at source on payment of certain sum for purchase of goods; 195:195- Other sums payable to a non-resident; 96A:196A- Income in respect of units of non-residents; 96B:196B- Payments in respect of units to an offshore fund; 96C:196C- Income from foreign currency bonds or shares of Indian; 96D:196D- Income of foreign institutional investors from securities; 96DA:196D(1A)/6DA- Income of specified fund from securities; 94BA-P: 194BA(2)/BAP-Sub-section (2) of section 194BA Net Winnings from online games where the net winnings are made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such net winnings are released; 
  - NameOfTenant: 
  - GrsRcptToTaxDeduct: integer
    (min: 0)    (max: 99999999999999)
  - DeductedYr:  - 2024:2024-25; 2023:2023-24; 2022:2022-23; 2021:2021-22; 2020:2020-21; 2019:2019-20; 2018:2018-19; 2017:2017-18;
  - TDSDeducted: integer
    (min: 0)    (max: 99999999999999)
  - TDSClaimed: integer
    (min: 0)    (max: 99999999999999)

---

## TDSonOthThanSal
Type: object
Required fields: EmployerOrDeductorOrCollectDetl, AmtForTaxDeduct, DeductedYr, TotTDSOnAmtPaid, ClaimOutOfTotTDSOnAmtPaid, TDSSection
Properties:
  - EmployerOrDeductorOrCollectDetl: (ref: #/definitions/EmployerOrDeductorOrCollectDetl)
  - TDSSection:  - 92A:192- Salary-Payment to Government employees other than Indian Government employees; 92B:192- Salary-Payment to employees other than Government employees; 92C:192- Salary-Payment to Indian Government employees; 192A:192A/2AA- TDS on PF withdrawal; 193:193- Interest on Securities; 194:194- Dividends; 94A:194A- Interest other than 'Interest on securities'; 94B:194B- Winning from lottery or crossword puzzle; 94BA:194BA- Winnings from online games; 4BB:194BB- Winning from horse race; 94C:194C- Payments to contractors and sub-contractors; 94D:194D- Insurance commission; 4DA:194DA- Payment in respect of life insurance policy; 94E:194E- Payments to non-resident sportsmen or sports associations; 4EE:194EE- Payments in respect of deposits under National Savings; 4F:194F/94F- Payments on account of repurchase of units by Mutual Fund or Unit Trust of India; 4G:194G/94G- Commission, price, etc. on sale of lottery tickets; 4H:194H/94H- Commission or brokerage; 4-IA:194I(a)/4IA- Rent on hiring of plant and machinery;  4-IB:194I(b)/4IB - Rent on other than plant and machinery; 4IA:194IA/9IA- TDS on Sale of immovable property; 4IB:194IB/9IB- Payment of rent by certain individuals or Hindu undivided; 4IC:194IC- Payment under specified agreement; 94J-A:194J(a)/4JA - Fees for technical services; 94J-B:194J(b)/4JB- Fees for professional  services or royalty etc; 94K:194K- Income payable to a resident assessee in respect of units of a specified mutual fund or of the units of the Unit Trust of India; 4LA:194LA- Payment of compensation on acquisition of certain immovable; 4LB:194LB- Income by way of Interest from Infrastructure Debt fund; 4LC1:194LC/LC1- 194LC (2)(i) and (ia) Income under clause (i) and (ia) of sub-section (2) of section 194LC; 4LC2:194LC/LC2- 194LC (2)(ib) Income under clause (ib) of sub-section (2) of section 194LC; 4LC3:194LC/LC3- 194LC (2)(ic) Income under clause (ic) of sub-section (2) of section 194LC; 4BA1:194LBA(a)/BA1- Certain income in the form of interest from units of a business trust to a resident unit holder; 4BA2: 194LBA(b)/BA2- Certain income in the form of dividend from units of a business trust to a resident unit holder; LBA1:194LBA(a)/BA1- 194LBA(a) income referred to in section 10(23FC)(a) from units of a business trust-NR; LBA2:194LBA(b)/BA2-194LBA(b) Income referred to in section 10(23FC)(b) from units of a business trust-NR; LBA3:194LBA(c)/BA3- 194LBA(c) Income referred to in section 10(23FCA) from units of a business trust-NR; LBB: 194LBB- Income in respect of units of investment fund; 94R:194R- Benefits or perquisites of business or profession; 94S:194S- Payment of consideration for transfer of virtual digital asset by persons other than specified persons; 94B-P:Proviso to section 194B/4BP- Winnings from lotteries and crossword puzzles where consideration is made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such winnings are released; 94R-P: First Proviso to sub-section(1) of section 194R/4RP- Benefits or perquisites of business or profession where such benefit is provided in kind or where part in cash is not sufficient to meet tax liability and tax required to be deducted is paid before such benefit is released; 94S-P:Proviso to sub- section(1) of section 194S/4SP- Payment for transfer of virtual digital asset where payment is in kind or in exchange of another virtual digital asset and tax required to be deducted is paid before such payment is released; LBC:194LBC- Income in respect of investment in securitization trust; 4LD:194LD- TDS on interest on bonds / government securities; 94M:194M- Payment of certain sums by certain individuals or HUF; 94N:194N- Payment of certain amounts in cash other than cases covered by first proviso or third proviso; 94N-F: 194N/4NF -First Proviso Payment of certain amounts in cash to non-filers except in case of co-operativesocieties; 94N-C:194N/4NC- Third Proviso Payment of certain amounts in cash to co-operative societies not covered by first proviso; 94N-FT: 194N/NFT- First Proviso read with Third Proviso Payment of certain amount in cash to non-filers being co-operative societies; 94O:194O- Payment of certain sums by e-commerce operator to e-commerce participant.; 94P: 194P- Deduction of tax in case of specified senior citizen; 94Q:194Q- Deduction of tax at source on payment of certain sum for purchase of goods; 195:195- Other sums payable to a non-resident; 96A:196A- Income in respect of units of non-residents; 96B:196B- Payments in respect of units to an offshore fund; 96C:196C- Income from foreign currency bonds or shares of Indian; 96D:196D- Income of foreign institutional investors from securities; 96DA:196D(1A)/6DA- Income of specified fund from securities; 94BA-P: 194BA(2)/BAP-Sub-section (2) of section 194BA Net Winnings from online games where the net winnings are made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such net winnings are released; 
  - AmtForTaxDeduct: integer
    (min: 0)    (max: 99999999999999)
  - DeductedYr:  - 2024: 2024-25; 2023: 2023-24; 2022: 2022-23; 2021: 2021-22; 2020: 2020-21; 2019: 2019-20; 2018: 2018-19; 2017: 2017-18; 2016: 2016-17; 2015: 2015-16; 2014: 2014-15; 2013: 2013-14; 2012: 2012-13; 2011: 2011-12; 2010: 2010-11; 2009: 2009-10; 2008: 2008-09
  - TotTDSOnAmtPaid: integer
    (min: 0)    (max: 99999999999999)
  - ClaimOutOfTotTDSOnAmtPaid: integer
    (min: 0)    (max: 99999999999999)

---

## TDSonOthThanSals
Description: 22. Details of Tax Deducted at Source on Interest [As per Form 16 A issued by Deductor(s)]
Type: object
Required fields: TotalTDSonOthThanSals
Properties:
  - TDSonOthThanSal: array
  - TotalTDSonOthThanSals: integer
    (min: 0)    (max: 99999999999999)

---

## TDSonSalaries
Description: Salary TDS details
Type: object
Required fields: TotalTDSonSalaries
Properties:
  - TDSonSalary: array
  - TotalTDSonSalaries: integer
    (min: 0)    (max: 99999999999999)

---

## TDSonSalary
Type: object
Required fields: EmployerOrDeductorOrCollectDetl, IncChrgSal, TotalTDSSal
Properties:
  - EmployerOrDeductorOrCollectDetl: (ref: #/definitions/EmployerOrDeductorOrCollectDetl)
  - IncChrgSal: integer
    (min: 0)    (max: 99999999999999)
  - TotalTDSSal: integer
    (min: 0)    (max: 99999999999999)

---

## TaxPayment
Description: Tax payment detail
Type: object
Required fields: BSRCode, DateDep, SrlNoOfChaln, Amt
Properties:
  - BSRCode: 
  - DateDep: string - Date of deposit should be on or after 2024-04-01  in YYYY-MM-DD format
  - SrlNoOfChaln: integer
    (min: 0)    (max: 99999)
  - Amt: integer
    (min: 0)    (max: 99999999999999)

---

## TaxPayments
Description: Tax payment details
Type: object
Required fields: TotalTaxPayments
Properties:
  - TaxPayment: array
  - TotalTaxPayments: integer
    (min: 0)    (max: 99999999999999)

---

## UsrDeductUndChapVIAType
Description: Deductions from income
Type: object
Required fields: Section80C, Section80CCC, Section80CCDEmployeeOrSE, Section80CCD1B, Section80CCDEmployer, Section80D, Section80DD, Section80DDB, Section80E, Section80EE, Section80G, Section80GG, Section80GGA, Section80GGC, Section80U, Section80TTA, Section80TTB, AnyOthSec80CCH, TotalChapVIADeductions
Properties:
  - Section80C: integer
    (min: 0)    (max: 99999999999999)
  - Section80CCC: integer
    (min: 0)    (max: 99999999999999)
  - Section80CCDEmployeeOrSE: integer - For Employee/SelfEmployed
    (min: 0)    (max: 99999999999999)
  - Section80CCD1B: integer
    (min: 0)    (max: 99999999999999)
  - Section80CCDEmployer: integer
    (min: 0)    (max: 99999999999999)
  - PRANNum: string
  - Section80D: integer
    (min: 0)    (max: 99999999999999)
  - Section80DD: integer
    (min: 0)    (max: 99999999999999)
  - Section80DDBUsrType:  - 1 : Self or dependent ; 2 : Self or Dependent - Senior Citizen
  - NameOfSpecDisease80DDB:  - a : Dementia; b : Dystonia Musculorum Deformans; c : Motor Neuron Disease; d : Ataxia; e : Chorea; f : Hemiballismus; g : Aphasia; h: Parkinsons Disease; i : Malignant Cancers; j : Full Blown Acquired Immuno-Deficiency Syndrome (AIDS); k:Chronic Renal failure; l:Hematological disorders; m: Hemophilia; n:Thalassaemia
  - Section80DDB: integer
    (min: 0)    (max: 99999999999999)
  - Section80E: integer
    (min: 0)    (max: 99999999999999)
  - Section80EE: integer
    (min: 0)    (max: 99999999999999)
  - Section80EEA: integer
    (min: 0)    (max: 99999999999999)
  - Section80EEB: integer
    (min: 0)    (max: 99999999999999)
  - Section80G: integer
    (min: 0)    (max: 99999999999999)
  - Section80GG: integer
    (min: 0)    (max: 99999999999999)
  - Form10BAAckNum: string
  - Section80GGA: integer
    (min: 0)    (max: 99999999999999)
  - Section80GGC: integer
    (min: 0)    (max: 99999999999999)
  - Section80U: integer
    (min: 0)    (max: 99999999999999)
  - Section80TTA: integer
    (min: 0)    (max: 99999999999999)
  - Section80TTB: integer
    (min: 0)    (max: 99999999999999)
  - AnyOthSec80CCH: integer
    (min: 0)    (max: 99999999999999)
  - TotalChapVIADeductions: integer
    (min: 0)    (max: 99999999999999)

---

## nonEmptyString
Type: string
Pattern: |(\s*([\w\d_=!@#$%\^*\(\){}\[\]\|\\:;',\.\?/~`\-\+<>&"][\s\w\d_=!@#$%\^*\(\){}\[\]\|\\:;',\.\?/~`\-\+<>&"]*)\s*)

---

## nonZeroString
Pattern: .*[1-9].*

---

