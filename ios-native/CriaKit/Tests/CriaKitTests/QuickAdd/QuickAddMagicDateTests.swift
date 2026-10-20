import XCTest
@testable import CriaKit

// Ported from Vikunja-web's `quickAddMagic.test.ts` (dates). Dates are checked as "yyyy-m-d" for an all-day value and
// "yyyy-m-d h:m" for a timed one, in UTC. Where Cria differs on purpose (an all-day bare date, the title's spacing)
// the expectation says so.

/// Thursday 24 June 2021, 12:00 UTC: the "now" of upstream's table tests.
let june24 = utcDate(2021, 6, 24, 12, 0)

func utcDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
    utcCalendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute)) ?? Date()
}

func magic(
    _ text: String, now: Date = june24, mode: QuickAddMagicMode = .vikunja, defaultTime: DefaultDueTime? = nil
) -> QuickAddResult {
    parseQuickAdd(text, now: now, mode: mode, calendar: utcCalendar, defaultDueTime: defaultTime)
}

/// "2021-6-24" for an all-day value, "2021-6-24 13:5" for a timed one; nil for none.
func stamp(_ iso: String?) -> String? {
    guard let parts = utcParts(iso), let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
    let date = "\(year)-\(month)-\(day)"
    guard DueDates.hasTimeOfDay(iso) else { return date }
    return "\(date) \(parts.hour ?? 0):\(parts.minute ?? 0)"
}

final class QuickAddMagicKeywordTests: XCTestCase {
    func testNoDateLeavesTheTextAlone() {
        let result = magic("Lorem Ipsum")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertNil(result.dueDate)
    }

    func testTodayIgnoringCase() {
        for text in ["Lorem Ipsum today", "Lorem Ipsum ToDay"] {
            let result = magic(text)
            XCTAssertEqual(result.title, "Lorem Ipsum")
            XCTAssertEqual(stamp(result.dueDate), "2021-6-24")
        }
    }

    func testTonightIsNinePM() {
        let result = magic("Lorem Ipsum tonight")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-24 21:0")
    }

    func testTodayWithATime() {
        let cases = [
            "at 15:00": "15:0", "@ 15:00": "15:0", "at 15:30": "15:30", "@ 3pm": "15:0", "at 3pm": "15:0", "at 3 pm": "15:0",
            "at 3am": "3:0", "at 3:12 am": "3:12", "at 3:12 pm": "15:12", "at 3:12 AM": "3:12", "at 3:12 PM": "15:12",
            "at 3:12 Am": "3:12", "at 3:12 Pm": "15:12", "at 12:00 pm": "12:0", "at 12:00 am": "0:0"
        ]
        for (time, expected) in cases {
            let result = magic("Lorem Ipsum today \(time)")
            XCTAssertEqual(result.title, "Lorem Ipsum", time)
            XCTAssertEqual(stamp(result.dueDate), "2021-6-24 \(expected)", time)
        }
    }

    func testTomorrow() {
        for text in ["Lorem Ipsum tomorrow", "Lorem Ipsum Tomorrow"] {
            XCTAssertEqual(stamp(magic(text).dueDate), "2021-6-25")
            XCTAssertEqual(magic(text).title, "Lorem Ipsum")
        }
    }

    func testNextMondayAnywhereAndAnyCase() {
        for text in ["Lorem Ipsum next monday", "next monday Lorem Ipsum", "Lorem Ipsum nExt Monday"] {
            let result = magic(text)
            XCTAssertEqual(result.title, "Lorem Ipsum")
            XCTAssertEqual(stamp(result.dueDate), "2021-6-28")
        }
    }

    func testNextMondayOnAMondayIsAWeekOn() {
        // Upstream's arithmetic returns today here; a week on is what the words mean.
        let monday = utcDate(2021, 6, 28, 12, 0)
        XCTAssertEqual(stamp(magic("Lorem Ipsum next monday", now: monday).dueDate), "2021-7-5")
    }

    func testThisWeekend() {
        XCTAssertEqual(stamp(magic("Lorem Ipsum this weekend").dueDate), "2021-6-26")
        XCTAssertEqual(magic("Lorem Ipsum this weekend").title, "Lorem Ipsum")
        // On a Saturday or Sunday it is today.
        XCTAssertEqual(stamp(magic("this weekend", now: utcDate(2021, 6, 26, 9)).dueDate), "2021-6-26")
        XCTAssertEqual(stamp(magic("this weekend", now: utcDate(2021, 6, 27, 9)).dueDate), "2021-6-27")
    }

    func testLaterThisWeekAndLaterNextWeek() {
        XCTAssertEqual(stamp(magic("Lorem Ipsum later this week").dueDate), "2021-6-26")
        XCTAssertEqual(stamp(magic("Lorem Ipsum later next week").dueDate), "2021-7-3")
        XCTAssertEqual(magic("Lorem Ipsum later next week").title, "Lorem Ipsum")
        // From Friday on it is today.
        XCTAssertEqual(stamp(magic("later this week", now: utcDate(2021, 6, 25, 9)).dueDate), "2021-6-25")
    }

    func testNextWeekNextMonthEndOfMonth() {
        XCTAssertEqual(stamp(magic("Lorem Ipsum next week").dueDate), "2021-7-1")
        XCTAssertEqual(stamp(magic("Lorem Ipsum next month").dueDate), "2021-7-1")
        XCTAssertEqual(stamp(magic("Lorem Ipsum end of month").dueDate), "2021-6-30")
        XCTAssertEqual(magic("Lorem Ipsum end of month").title, "Lorem Ipsum")
    }

    func testWeekdayWithATime() {
        let result = magic("Lorem Ipsum thu at 14:00")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-24 14:0")
        XCTAssertEqual(stamp(magic("Lorem Ipsum fri at 14:00").dueDate), "2021-6-25 14:0")
    }

    func testDefaultDueTimeAppliesToADateWithoutATime() {
        let time = DefaultDueTime(hour: 14, minute: 30)
        for text in ["plan this tomorrow", "Epic test task 2026-10-13", "Epic test task 13.10.2026", "Epic test task oct 13",
                     "Epic test task friday", "Epic test task 17th"] {
            let now = utcDate(2026, 8, 4, 9, 15)
            XCTAssertTrue(stamp(magic(text, now: now, defaultTime: time).dueDate)?.hasSuffix(" 14:30") == true, text)
        }
    }

    func testExplicitTimeBeatsTheDefaultDueTime() {
        let now = utcDate(2026, 8, 4, 9, 15)
        let result = magic("Epic test task 2026-10-13 at 15:00", now: now, defaultTime: DefaultDueTime(hour: 23, minute: 59))
        XCTAssertEqual(stamp(result.dueDate), "2026-10-13 15:0")
    }

    func testNoDefaultDueTimeKeepsADateAllDay() {
        let result = magic("Epic test task 2026-10-13", now: utcDate(2026, 8, 4, 9, 15))
        XCTAssertEqual(stamp(result.dueDate), "2026-10-13")
    }

    func testTonightKeepsTheDefaultTimesMinutes() {
        let result = magic("dinner tonight", defaultTime: DefaultDueTime(hour: 9, minute: 30))
        XCTAssertEqual(stamp(result.dueDate), "2021-6-24 21:30")
    }
}

final class QuickAddMagicDayOfMonthTests: XCTestCase {
    func testDayOfMonthAlreadyPassedMeansNextMonth() {
        let now = utcDate(2022, 1, 15, 12)
        let result = magic("Lorem Ipsum 14th", now: now)
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(stamp(result.dueDate), "2022-2-14")
    }

    func testDayOfMonthWhenFebruaryFollows() {
        let now = utcDate(2022, 1, 30, 12)
        XCTAssertEqual(stamp(magic("Lorem Ipsum 29th", now: now).dueDate), "2022-3-29")
    }

    func testThirtyFirstWhenTheNextMonthIsShort() {
        let now = utcDate(2022, 4, 1, 0)
        XCTAssertEqual(stamp(magic("Lorem Ipsum 31st", now: now).dueDate), "2022-5-31")
    }

    func testTodaysDayNumberIsToday() {
        XCTAssertEqual(stamp(magic("Lorem Ipsum 24th").dueDate), "2021-6-24")
    }

    func testFutureDayOfMonth() {
        let result = magic("Lorem Ipsum 25nd")
        XCTAssertEqual(result.title, "Lorem Ipsum")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-25")
    }

    func testOrdinalNeedsAnEndAtOrMonthAfterIt() {
        for text in ["Renovation - 2nd Floor Bath", "Remark - 13th floor", "13th floor - remark"] {
            XCTAssertNil(magic(text).dueDate, text)
            XCTAssertEqual(magic(text).title, text)
        }
    }
}

final class QuickAddMagicNotADateTests: XCTestCase {
    private let words = [
        "renewed", "github", "fix monitor stand", "order wedding cake", "investigate thumping noise", "iron frilly napkins",
        "take photo of saturn", "fix sunglasses", "monitor blood pressure", "Monitor blood pressure", "buy almonds",
        "Renovation", "Remark", "Renovation - 2nd Floor Bath", "Remark - 13th floor", "13th floor - remark"
    ]

    func testPartialKeywordsInWordsAreText() {
        for word in words {
            for text in ["\(word) dolor sit amet", "Lorem Ipsum \(word)", "Lorem Ipsum \(word) dolor", word] {
                let result = magic(text)
                XCTAssertEqual(result.title, text)
                XCTAssertNil(result.dueDate, text)
            }
        }
    }

    func testDatesInTheMiddleOfTextAreText() {
        for text in ["The 9/11 Report", "The 01/02 Report", "a]7/8 debate", "The 1.2 formula"] {
            XCTAssertEqual(magic(text).title, text)
            XCTAssertNil(magic(text).dueDate, text)
        }
    }

    func testDateRangesAreText() {
        let ranges = [
            "31.12.2026 - 01.01.2027 Happy new year", "Happy new year 31.12.2026 - 01.01.2027",
            "31.12.2026 \u{2013} 01.01.2027 Happy new year", "12/31/2026 - 01/01/2027 Happy new year",
            "2026-12-31 - 2027-01-01 Happy new year", "31.12 - 01.01 Happy new year"
        ]
        for text in ranges {
            XCTAssertEqual(magic(text).title, text)
            XCTAssertNil(magic(text).dueDate, text)
        }
    }

    func testADateAfterANonRangeDashStillParses() {
        let result = magic("Meeting - 31.12.2026")
        XCTAssertEqual(result.title, "Meeting -")
        XCTAssertEqual(stamp(result.dueDate), "2026-12-31")
    }

    func testVersionNumbersAndUrlsAreText() {
        for text in ["Lorem Ispum v1.1.1", "https://some-url.org/blog/2019/1/233526-some-more-text"] {
            XCTAssertEqual(magic(text).title, text)
            XCTAssertNil(magic(text).dueDate, text)
        }
    }

    func testWordsAroundAWeekdayStopItBeingOne() {
        for day in ["monday", "Mon", "tuesday", "wed", "thursday", "fri", "saturday", "Sat", "sunday", "Sun"] {
            for text in ["Lorem Ipsum \(day)ipsum", "Lorem ipsum\(day) dolor", "Lorem Ipsum lorem\(day)ipsum"] {
                XCTAssertEqual(magic(text).title, text)
                XCTAssertNil(magic(text).dueDate, text)
            }
        }
    }

    func testYearFirstDatesNeverSwapDayAndMonth() {
        XCTAssertNil(magic("Pay 2026-13-01").dueDate)
        XCTAssertNil(magic("Pay 2026-02-30").dueDate)
        XCTAssertEqual(stamp(magic("Pay 2026-02-28").dueDate), "2026-2-28")
    }

    func testAMonthNameNeedsToEndTheWord() {
        XCTAssertNil(magic("Buy 2 marbles").dueDate)
        XCTAssertEqual(magic("Buy 2 marbles").title, "Buy 2 marbles")
    }

    func testInNeedsToStartTheWord() {
        XCTAssertNil(magic("Finish within 3 days").dueDate)
    }

    func testOutOfRangeTimeStaysInTheTitle() {
        let result = magic("Meet tomorrow at 25:00")
        XCTAssertEqual(result.title, "Meet at 25:00")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-25")
    }
}

final class QuickAddMagicWeekdayTests: XCTestCase {
    private let days: [(String, Int)] = [
        ("monday", 1), ("Monday", 1), ("mon", 1), ("Mon", 1), ("tuesday", 2), ("Tuesday", 2), ("tue", 2), ("Tue", 2),
        ("wednesday", 3), ("Wednesday", 3), ("wed", 3), ("Wed", 3), ("thursday", 4), ("Thursday", 4), ("thu", 4), ("Thu", 4),
        ("friday", 5), ("Friday", 5), ("fri", 5), ("Fri", 5), ("saturday", 6), ("Saturday", 6), ("sat", 6), ("Sat", 6),
        ("sunday", 0), ("Sunday", 0), ("sun", 0), ("Sun", 0)
    ]

    func testEveryWeekdayWithAndWithoutNext() {
        // Thursday 24 June 2021: the days run on from there, today included, and "next" changes nothing.
        for (name, number) in days {
            let distance = (number + 7 - 4) % 7
            let expected = stamp(DueDates.allDayISO(for: utcDate(2021, 6, 24 + distance), calendar: utcCalendar))
            for text in ["Lorem Ipsum \(name)", "\(name) Lorem Ipsum", "Lorem Ipsum next \(name)", "next \(name) Lorem Ipsum"] {
                let result = magic(text)
                XCTAssertEqual(result.title, "Lorem Ipsum", text)
                XCTAssertEqual(stamp(result.dueDate), expected, text)
            }
        }
    }
}

final class QuickAddMagicDateTableTests: XCTestCase {
    func testDatesWrittenOut() {
        let cases: [(String, String?)] = [
            ("06/08/2021", "2021-6-8"), ("6/7/21", "2021-6-7"), ("27/07/2021,", nil), ("2021/07/06", "2021-7-6"),
            ("2021-07-06", "2021-7-6"), ("27 jan", "2022-1-27"), ("27/1", "2022-1-27"), ("27/01", "2022-1-27"),
            ("16/12", "2021-12-16"), ("01/27", "2022-1-27"), ("1/27", "2022-1-27"), ("jan 27", "2022-1-27"),
            ("Jan 27", "2022-1-27"), ("january 27", "2022-1-27"), ("January 27", "2022-1-27"), ("feb 21", "2022-2-21"),
            ("february 21", "2022-2-21"), ("mar 21", "2022-3-21"), ("March 21", "2022-3-21"), ("apr 21", "2022-4-21"),
            ("may 21", "2022-5-21"), ("May 21", "2022-5-21"), ("jun 21", "2022-6-21"), ("June 21", "2022-6-21"),
            ("21st June", "2021-6-21"), ("2nd March", "2021-3-2"), ("2nd march", "2021-3-2"), ("3rd April", "2021-4-3"),
            ("1st January", "2021-1-1"), ("22nd December", "2021-12-22"), ("23rd October", "2021-10-23"),
            ("4th July", "2021-7-4"), ("15th August", "2021-8-15"), ("31st December", "2021-12-31"), ("5th Mar", "2021-3-5"),
            ("12th Sep", "2021-9-12"), ("jul 21", "2021-7-21"), ("July 21", "2021-7-21"), ("aug 21", "2021-8-21"),
            ("August 21", "2021-8-21"), ("sep 21", "2021-9-21"), ("September 21", "2021-9-21"), ("oct 21", "2021-10-21"),
            ("October 21", "2021-10-21"), ("nov 21", "2021-11-21"), ("November 21", "2021-11-21"), ("dec 21", "2021-12-21"),
            ("December 21", "2021-12-21"), ("01.02.2021", "2021-2-1"), ("01.02", "2022-2-1"), ("01.10", "2021-10-1"),
            ("01.02.25", "2025-2-1")
        ]
        for (phrase, expected) in cases {
            for text in ["Lorem Ipsum \(phrase)", "\(phrase) Lorem Ipsum"] {
                let result = magic(text)
                XCTAssertEqual(stamp(result.dueDate), expected, text)
                if expected != nil { XCTAssertEqual(result.title, "Lorem Ipsum", text) }
            }
        }
    }

    func testDatesAtTheEdgesOfTheText() {
        let now = utcDate(2021, 6, 24, 12)
        let cases: [(String, String, String)] = [
            ("9/11 meeting", "2021-9-11", "meeting"), ("meeting 9/11", "2021-9-11", "meeting"),
            ("meeting 9/11 at 10:00", "2021-9-11 10:0", "meeting"), ("meeting 9/11 @ 15:00", "2021-9-11 15:0", "meeting"),
            ("2021-06-24 Lorem Ipsum", "2021-6-24", "Lorem Ipsum"), ("Lorem Ipsum 06/26/2021", "2021-6-26", "Lorem Ipsum"),
            ("01.02 Lorem Ipsum", "2022-2-1", "Lorem Ipsum"), ("Lorem Ipsum 01.02", "2022-2-1", "Lorem Ipsum"),
            ("The 9/11 Report due 10/12", "2021-10-12", "The 9/11 Report due")
        ]
        for (text, expected, title) in cases {
            let result = magic(text, now: now)
            XCTAssertEqual(stamp(result.dueDate), expected, text)
            XCTAssertEqual(result.title, title, text)
        }
    }

    func testTodaysDateWithoutAYearStaysToday() {
        // Upstream compares with the current time and so jumps a year on for today's date.
        XCTAssertEqual(stamp(magic("Lorem Ipsum 24.06").dueDate), "2021-6-24")
        XCTAssertEqual(stamp(magic("Lorem Ipsum jun 24").dueDate), "2021-6-24")
    }

    func testRelativeAndOrdinalPhrasesWithTimes() {
        let cases = [
            "Lorem Ipsum in 1 hour": "2021-6-24 13:0", "in 2 hours": "2021-6-24 14:0", "in 1 day": "2021-6-25 12:0",
            "in 2 days": "2021-6-26 12:0", "in 1 week": "2021-7-1 12:0", "in 2 weeks": "2021-7-8 12:0",
            "in 4 weeks": "2021-7-22 12:0", "in 1 month": "2021-7-24 12:0", "in 3 months": "2021-9-24 12:0",
            "Something in 5 days at 10:00": "2021-6-29 10:0", "Something 17th at 10:00": "2021-7-17 10:0",
            "Something sep 17 at 10:00": "2021-9-17 10:0", "Something sep 17th at 10:00": "2021-9-17 10:0",
            "Something at 10:00 in 5 days": "2021-6-29 10:0", "Something at 10:00 17th": "2021-7-17 10:0",
            "Something at 10:00 sep 17th": "2021-9-17 10:0", "2nd March at 5": "2021-3-2 5:0",
            "2nd March at 5pm": "2021-3-2 17:0", "2nd March @ 14:00": "2021-3-2 14:0", "3rd April at 10:30": "2021-4-3 10:30",
            "15th August @ 9am": "2021-8-15 9:0", "21st June at 18:45": "2021-6-21 18:45", "5th Mar at 3pm": "2021-3-5 15:0"
        ]
        for (text, expected) in cases { XCTAssertEqual(stamp(magic(text).dueDate), expected, text) }
    }

    func testTheTitleLosesTheDateWords() {
        XCTAssertEqual(magic("Some task Mar 8th").title, "Some task")
        XCTAssertEqual(magic("Some task mar 8th").title, "Some task")
        XCTAssertEqual(stamp(magic("Some task Mar 8th").dueDate), "2021-3-8")
    }

    func testOnlyTheFirstCopyOfADatePhraseIsCut() {
        // Upstream strips every copy, even inside other words.
        XCTAssertEqual(magic("Lorem fri africa fri").title, "Lorem africa fri")
    }

    func testTimeWithoutADateIsToday() {
        let result = magic("Call Sam at 3pm")
        XCTAssertEqual(result.title, "Call Sam")
        XCTAssertEqual(stamp(result.dueDate), "2021-6-24 15:0")
        XCTAssertEqual(stamp(magic("Call Sam at 9am").dueDate), "2021-6-24 9:0", "even when it has passed")
    }
}
