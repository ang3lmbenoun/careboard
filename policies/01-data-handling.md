---
title: CareBoard data handling rules
visibility: public
source: CareBoard documentation (synthetic demo policy)
---
Patients are identified by patient number only. Names and birth dates are not readable by any role in the application, including clinicians, executives and administrators.

Any count below 5 is hidden in summary views so a small group cannot identify a person. This minimum of 5 is a design choice for this project, not a legal rule.

All patients, appointments and clinic activity are synthetic. Medicaid and Medicare drug spending comes from public CMS data.
